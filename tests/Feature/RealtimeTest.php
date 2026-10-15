<?php

namespace Tests\Feature;

use App\Events\RoomChanged;
use App\Models\Meeting;
use App\Models\User;
use App\Services\RoomRealtime;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

class RealtimeTest extends TestCase
{
    use RefreshDatabase;

    private function room(): array
    {
        config([
            'broadcasting.default' => 'pusher',
            'broadcasting.connections.pusher.key' => 'test-key',
            'broadcasting.connections.pusher.secret' => 'test-secret',
            'broadcasting.connections.pusher.app_id' => 'test-app',
            'broadcasting.connections.pusher.options.cluster' => 'mt1',
        ]);
        Event::fake([RoomChanged::class]);
        $user = User::factory()->create();
        $meeting = Meeting::create(['user_id' => $user->id, 'code' => 'live-room-test', 'title' => 'Presence', 'duration' => 30, 'waiting_room' => false]);
        $id = (string) Str::uuid();
        DB::table('participants')->insert([
            'id' => $id, 'meeting_id' => $meeting->id, 'name' => 'Guest',
            'status' => 'admitted', 'is_host' => false,
            'last_seen' => now()->subHours(2), 'created_at' => now()->subHours(2), 'updated_at' => now(),
        ]);

        return [$meeting, $id];
    }

    public function test_guest_presence_authorization_uses_room_session_and_participant_uuid(): void
    {
        [$meeting, $id] = $this->room();
        $channel = 'presence-meeting.'.$meeting->code;
        $response = $this->withSession(['rooms' => [$meeting->id => $id]])
            ->postJson('/m/'.$meeting->code.'/realtime-auth', ['socket_id' => '123.456', 'channel_name' => $channel])
            ->assertOk();
        $data = $response->json();
        $this->assertSame($id, json_decode($data['channel_data'], true)['user_id']);
        $this->assertSame('test-key:'.hash_hmac('sha256', '123.456:'.$channel.':'.$data['channel_data'], 'test-secret'), $data['auth']);
        $this->postJson('/m/'.$meeting->code.'/realtime-auth', ['socket_id' => '123.456', 'channel_name' => 'presence-meeting.another-room'])->assertForbidden();
    }

    public function test_strangers_removed_members_and_ended_rooms_cannot_authorize_presence(): void
    {
        [$meeting, $id] = $this->room();
        $payload = ['socket_id' => '123.456', 'channel_name' => 'presence-meeting.'.$meeting->code];
        $this->postJson('/m/'.$meeting->code.'/realtime-auth', $payload)->assertForbidden();
        DB::table('participants')->where('id', $id)->update(['status' => 'removed']);
        $this->withSession(['rooms' => [$meeting->id => $id]])->postJson('/m/'.$meeting->code.'/realtime-auth', $payload)->assertForbidden();
        DB::table('participants')->where('id', $id)->update(['status' => 'admitted']);
        $meeting->update(['ended_at' => now()]);
        $this->postJson('/m/'.$meeting->code.'/realtime-auth', $payload)->assertStatus(410);
    }

    public function test_idle_socket_members_do_not_expire_and_no_http_heartbeat_route_exists(): void
    {
        [$meeting, $id] = $this->room();
        $this->withSession(['rooms' => [$meeting->id => $id]])
            ->getJson('/m/'.$meeting->code.'/poll')->assertOk()->assertJsonCount(1, 'participants');
        $this->postJson('/m/'.$meeting->code.'/heartbeat')->assertNotFound();
    }

    public function test_prune_uses_socket_presence_and_preserves_members_during_an_outage(): void
    {
        [$meeting, $id] = $this->room();
        $offline = (string) Str::uuid();
        DB::table('participants')->insert([
            'id' => $offline, 'meeting_id' => $meeting->id, 'name' => 'Offline',
            'status' => 'admitted', 'is_host' => false,
            'last_seen' => now()->subHours(2), 'created_at' => now()->subHours(2), 'updated_at' => now(),
        ]);
        $this->mock(RoomRealtime::class, function ($mock) use ($id) {
            $mock->shouldReceive('enabled')->andReturn(true);
            $mock->shouldReceive('participantIds')->andReturn([$id], null);
        });
        $this->artisan('meetings:prune')->assertSuccessful();
        $this->assertDatabaseHas('participants', ['id' => $id, 'status' => 'admitted']);
        $this->assertDatabaseHas('participants', ['id' => $offline, 'status' => 'left']);
        $this->artisan('meetings:prune')->assertSuccessful();
        $this->assertDatabaseHas('participants', ['id' => $id, 'status' => 'admitted']);
    }

    public function test_disconnected_stale_members_do_not_occupy_capacity(): void
    {
        [$meeting, $id] = $this->room();
        foreach (range(1, 7) as $number) {
            DB::table('participants')->insert([
                'id' => (string) Str::uuid(), 'meeting_id' => $meeting->id, 'name' => 'Stale '.$number,
                'status' => 'admitted', 'is_host' => false,
                'last_seen' => now()->subMinutes(10), 'created_at' => now()->subMinutes(10), 'updated_at' => now(),
            ]);
        }
        $this->mock(RoomRealtime::class, function ($mock) use ($id) {
            $mock->shouldReceive('enabled')->andReturn(true);
            $mock->shouldReceive('participantIds')->andReturn([$id]);
        });
        $this->postJson('/m/'.$meeting->code.'/enter', ['name' => 'New guest', 'audio' => false, 'video' => false])->assertOk();
    }
}
