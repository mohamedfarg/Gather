<?php

namespace Tests\Feature;

use App\Models\Meeting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class MeetingTest extends TestCase
{
    use RefreshDatabase;

    private function meeting(array $attributes = []): Meeting
    {
        return Meeting::create($attributes + ['user_id' => User::factory()->create()->id, 'code' => 'abcd-efgh-ijkl', 'title' => 'Planning', 'duration' => 30, 'waiting_room' => true]);
    }

    private function member(Meeting $m, array $attributes = []): string
    {
        $id = (string) Str::uuid();
        DB::table('participants')->insert($attributes + ['id' => $id, 'meeting_id' => $m->id, 'name' => 'Guest', 'status' => 'admitted', 'is_host' => false, 'last_seen' => now(), 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    public function test_registration_hashes_password_and_logs_in(): void
    {
        $this->post('/register', ['name' => 'Alex', 'email' => 'alex@example.test', 'password' => 'strong-password', 'password_confirmation' => 'strong-password'])->assertRedirect('/dashboard');
        $user = User::first();
        $this->assertAuthenticatedAs($user);
        $this->assertTrue(Hash::check('strong-password', $user->password));
        $this->get('/dashboard')->assertOk()->assertSee('Hello, Alex.');
        $this->post('/logout')->assertRedirect('/');
        $this->assertGuest();
        $this->post('/login', ['email' => 'alex@example.test', 'password' => 'wrong'])->assertSessionHasErrors('email');
        $this->post('/login', ['email' => 'alex@example.test', 'password' => 'strong-password'])->assertRedirect('/dashboard');
    }

    public function test_guest_cannot_create_or_close_meetings(): void
    {
        $m = $this->meeting();
        $this->post('/meetings', ['title' => 'Test', 'duration' => 30])->assertRedirect('/login');
        $this->actingAs(User::factory()->create())->delete('/meetings/'.$m->code)->assertForbidden();
    }

    public function test_scheduling_normalizes_time_and_ownership(): void
    {
        $host = User::factory()->create();
        $date = now()->addDays(2)->startOfSecond()->setTimezone('Africa/Cairo');
        $this->actingAs($host)->post('/meetings', ['title' => 'Catch-up', 'duration' => 60, 'scheduled_at' => $date->toIso8601String(), 'waiting_room' => 1])->assertRedirect('/dashboard');
        $m = Meeting::first();
        $this->assertSame($host->id, $m->user_id);
        $this->assertTrue($m->scheduled_at->equalTo($date));
        $this->get('/join?code='.urlencode('http://localhost/m/'.$m->code))->assertRedirect('/m/'.$m->code);
        $this->delete('/meetings/'.$m->code)->assertRedirect('/dashboard');
        $this->get('/dashboard?view=history')->assertSee('Catch-up');
    }

    public function test_waiting_guests_cannot_read_chat_or_signal_before_admission(): void
    {
        $m = $this->meeting();
        $host = $this->member($m, ['is_host' => true, 'name' => 'Host']);
        DB::table('messages')->insert(['meeting_id' => $m->id, 'participant_id' => $host, 'name' => 'Host', 'body' => 'Private room message', 'created_at' => now()]);
        $result = $this->postJson('/m/'.$m->code.'/enter', ['name' => 'Visitor', 'audio' => false, 'video' => false])->assertOk();
        $this->assertSame('waiting', $result->json('participant.status'));
        $this->getJson('/m/'.$m->code.'/poll')->assertOk()->assertJsonCount(0, 'messages')->assertJsonCount(0, 'events');
        $this->postJson('/m/'.$m->code.'/chat', ['body' => 'Sneak in'])->assertForbidden();
        $this->postJson('/m/'.$m->code.'/signal', ['target' => $host, 'type' => 'offer', 'payload' => ['type' => 'offer', 'sdp' => 'test']])->assertForbidden();
    }

    public function test_host_admission_and_guest_controls_are_enforced(): void
    {
        $m = $this->meeting();
        $host = $this->member($m, ['is_host' => true, 'user_id' => $m->user_id]);
        $guest = $this->member($m, ['status' => 'waiting']);
        $this->actingAs($m->host)->withSession(['rooms' => [$m->id => $host]])->postJson('/m/'.$m->code.'/control', ['action' => 'admit', 'target' => $guest])->assertNoContent();
        $this->assertDatabaseHas('participants', ['id' => $guest, 'status' => 'admitted']);
        auth()->logout();
        $this->withSession(['rooms' => [$m->id => $guest]])->postJson('/m/'.$m->code.'/control', ['action' => 'end'])->assertForbidden();
    }

    public function test_removed_participants_cannot_rejoin_or_poll(): void
    {
        $m = $this->meeting();
        $id = $this->member($m, ['status' => 'removed']);
        $this->withSession(['rooms' => [$m->id => $id]])->postJson('/m/'.$m->code.'/enter', ['name' => 'Again', 'audio' => false, 'video' => false])->assertForbidden();
        $this->getJson('/m/'.$m->code.'/poll')->assertForbidden();
    }

    public function test_lock_blocks_new_guests_but_allows_host(): void
    {
        $m = $this->meeting(['locked' => true]);
        $this->postJson('/m/'.$m->code.'/enter', ['name' => 'Guest', 'audio' => false, 'video' => false])->assertStatus(423);
        $this->actingAs($m->host)->postJson('/m/'.$m->code.'/enter', ['name' => 'Host', 'audio' => false, 'video' => false])->assertOk()->assertJsonPath('participant.status', 'admitted');
    }

    public function test_capacity_reserves_a_slot_for_host_and_ignores_stale_members(): void
    {
        $m = $this->meeting();
        for ($i = 0; $i < 7; $i++) {
            $this->member($m, ['status' => 'waiting']);
        }
        $this->postJson('/m/'.$m->code.'/enter', ['name' => 'Overflow', 'audio' => false, 'video' => false])->assertStatus(409);
        $this->actingAs($m->host)->postJson('/m/'.$m->code.'/enter', ['name' => 'Host', 'audio' => false, 'video' => false])->assertOk();
        DB::table('participants')->where('is_host', false)->update(['last_seen' => now()->subMinute()]);
        auth()->logout();
        $this->flushSession();
        $this->postJson('/m/'.$m->code.'/enter', ['name' => 'New guest', 'audio' => false, 'video' => false])->assertOk();
    }

    public function test_signals_are_only_visible_to_target_in_same_room(): void
    {
        $m = $this->meeting();
        $sender = $this->member($m);
        $target = $this->member($m);
        $other = $this->member($m);
        $sdp = "v=0\r\ns=example\r\n";
        $this->withSession(['rooms' => [$m->id => $sender]])->postJson('/m/'.$m->code.'/signal', ['target' => $target, 'type' => 'offer', 'payload' => ['type' => 'offer', 'sdp' => $sdp]])->assertNoContent();
        $this->assertSame($sdp, json_decode(DB::table('meeting_events')->first()->payload, true)['sdp']);
        $this->withSession(['rooms' => [$m->id => $other]])->getJson('/m/'.$m->code.'/poll')->assertJsonCount(0, 'events')->assertJsonPath('cursor', 1);
        $this->withSession(['rooms' => [$m->id => $target]])->getJson('/m/'.$m->code.'/poll')->assertJsonCount(1, 'events')->assertJsonPath('events.0.sender', $sender);
        $foreign = $this->meeting(['code' => 'mnop-qrst-uvwx']);
        $outsider = $this->member($foreign);
        $this->withSession(['rooms' => [$m->id => $sender]])->postJson('/m/'.$m->code.'/signal', ['target' => $outsider, 'type' => 'ice', 'payload' => ['candidate' => 'test']])->assertUnprocessable();
    }

    public function test_chat_state_and_leave_work_and_validate_input(): void
    {
        $m = $this->meeting();
        $id = $this->member($m);
        $this->withSession(['rooms' => [$m->id => $id]])->postJson('/m/'.$m->code.'/chat', ['body' => '<script>alert(1)</script>'])->assertNoContent();
        $this->getJson('/m/'.$m->code.'/poll')->assertJsonPath('messages.0.body', '<script>alert(1)</script>');
        $this->postJson('/m/'.$m->code.'/chat', ['body' => str_repeat('a', 2001)])->assertUnprocessable();
        $this->patchJson('/m/'.$m->code.'/state', ['hand' => true, 'audio' => true])->assertNoContent();
        $this->assertDatabaseHas('participants', ['id' => $id, 'hand' => true, 'audio' => true]);
        $this->postJson('/m/'.$m->code.'/leave')->assertNoContent();
        $this->getJson('/m/'.$m->code.'/poll')->assertForbidden();
    }

    public function test_end_revokes_room_access(): void
    {
        $m = $this->meeting();
        $host = $this->member($m, ['is_host' => true, 'user_id' => $m->user_id]);
        $this->actingAs($m->host)->withSession(['rooms' => [$m->id => $host]])->postJson('/m/'.$m->code.'/control', ['action' => 'end'])->assertNoContent();
        $this->getJson('/m/'.$m->code.'/poll')->assertStatus(410);
        $this->postJson('/m/'.$m->code.'/enter', ['name' => 'Host', 'audio' => false, 'video' => false])->assertStatus(410);
    }

    public function test_turn_credentials_are_temporary_and_no_public_servers_are_default(): void
    {
        $m = $this->meeting(['waiting_room' => false]);
        $this->postJson('/m/'.$m->code.'/enter', ['name' => 'Guest', 'audio' => false, 'video' => false])->assertOk()->assertJsonPath('iceServers', []);
        config(['meeting.turn_urls' => ['turn:turn.example.test:3478'], 'meeting.turn_secret' => 'local-test-secret']);
        $result = $this->postJson('/m/'.$m->code.'/enter', ['name' => 'Guest', 'audio' => false, 'video' => false])->assertOk();
        $ice = $result->json('iceServers.0');
        $this->assertSame(base64_encode(hash_hmac('sha1', $ice['username'], 'local-test-secret', true)), $ice['credential']);
        $this->assertGreaterThan(now()->timestamp, (int) explode(':', $ice['username'])[0]);
    }

    public function test_settings_require_current_password_and_update_hash(): void
    {
        $user = User::factory()->create(['password' => 'old-password']);
        $this->actingAs($user)->patch('/settings', ['name' => 'Updated', 'email' => $user->email, 'current_password' => 'incorrect'])->assertSessionHasErrors('current_password');
        $this->patch('/settings', ['name' => 'Updated', 'email' => $user->email, 'current_password' => 'old-password', 'password' => 'new-password', 'password_confirmation' => 'new-password'])->assertSessionHasNoErrors();
        $this->assertTrue(Hash::check('new-password', $user->fresh()->password));
    }

    public function test_pruning_does_not_remove_messages(): void
    {
        $m = $this->meeting();
        $id = $this->member($m, ['last_seen' => now()->subMinutes(6)]);
        DB::table('meeting_events')->insert(['meeting_id' => $m->id, 'sender' => $id, 'target' => $id, 'type' => 'ice', 'payload' => '{}', 'created_at' => now()->subMinutes(11)]);
        DB::table('messages')->insert(['meeting_id' => $m->id, 'participant_id' => $id, 'name' => 'Guest', 'body' => 'Keep this', 'created_at' => now()->subDay()]);
        $this->artisan('meetings:prune')->assertSuccessful();
        $this->assertDatabaseCount('meeting_events', 0);
        $this->assertDatabaseCount('messages', 1);
        $this->assertDatabaseHas('participants', ['id' => $id, 'status' => 'left']);
    }

    public function test_room_polling_does_not_use_registration_rate_limit(): void
    {
        $m = $this->meeting();
        $id = $this->member($m);
        $this->withSession(['rooms' => [$m->id => $id]]);
        for ($i = 0; $i < 12; $i++) {
            $this->getJson('/m/'.$m->code.'/poll')->assertOk();
        }
        $this->post('/register', ['name' => 'New user', 'email' => 'fresh@example.test', 'password' => 'strong-password', 'password_confirmation' => 'strong-password'])->assertRedirect('/dashboard');
    }
}
