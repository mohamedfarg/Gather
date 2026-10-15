<?php

namespace Tests\Feature;

use App\Models\Meeting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class MeetingFeaturesTest extends TestCase
{
    use RefreshDatabase;

    private function room(): array
    {
        $user = User::factory()->create();
        $meeting = Meeting::create(['user_id' => $user->id, 'code' => 'abcd-efgh-ijkl', 'title' => 'User title', 'duration' => 30, 'waiting_room' => false]);
        $host = $this->member($meeting, true);
        $guest = $this->member($meeting);

        return [$meeting, $user, $host, $guest];
    }

    private function member(Meeting $meeting, bool $host = false): string
    {
        $id = (string) Str::uuid();
        DB::table('participants')->insert(['id' => $id, 'meeting_id' => $meeting->id, 'name' => 'User name', 'is_host' => $host, 'audio' => true, 'status' => 'admitted', 'last_seen' => now(), 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    public function test_host_mute_all_blocks_unmute_until_permission_and_covers_new_guests(): void
    {
        [$m,$user,$host,$guest] = $this->room();
        $this->actingAs($user)->withSession(['rooms' => [$m->id => $host]])->postJson('/m/'.$m->code.'/control', ['action' => 'mute_all'])->assertNoContent();
        $this->assertDatabaseHas('participants', ['id' => $guest, 'audio' => false, 'audio_locked' => true]);
        $this->assertDatabaseHas('participants', ['id' => $host, 'audio' => true, 'audio_locked' => false]);
        auth()->logout();
        $this->withSession(['rooms' => [$m->id => $guest]])->patchJson('/m/'.$m->code.'/state', ['audio' => true])->assertForbidden();
        $this->patchJson('/m/'.$m->code.'/state', ['hand' => true])->assertNoContent();
        $this->postJson('/m/'.$m->code.'/control', ['action' => 'allow', 'target' => $guest])->assertForbidden();
        $this->flushSession();
        $this->postJson('/m/'.$m->code.'/enter', ['name' => 'New guest', 'audio' => true, 'video' => false])->assertOk()->assertJsonPath('participant.audio', 0)->assertJsonPath('participant.audio_locked', 1);
        $this->actingAs($user)->withSession(['rooms' => [$m->id => $host]])->postJson('/m/'.$m->code.'/control', ['action' => 'allow', 'target' => $guest])->assertNoContent();
        $this->assertDatabaseHas('participants', ['id' => $guest, 'audio' => false, 'audio_locked' => false, 'hand' => false]);
        auth()->logout();
        $this->withSession(['rooms' => [$m->id => $guest]])->patchJson('/m/'.$m->code.'/state', ['audio' => true])->assertNoContent();
    }

    public function test_host_can_unmute_even_if_a_stale_host_lock_exists(): void
    {
        [$meeting, $user, $host] = $this->room();
        DB::table('participants')->where('id', $host)->update(['audio_locked' => true, 'audio' => false]);

        $this->actingAs($user)
            ->withSession(['rooms' => [$meeting->id => $host]])
            ->patchJson('/m/'.$meeting->code.'/state', ['audio' => true])
            ->assertNoContent();

        $this->assertDatabaseHas('participants', [
            'id' => $host,
            'audio' => true,
            'audio_locked' => false,
        ]);
    }

    public function test_guest_reactions_are_validated_and_waiting_guests_do_not_receive_them(): void
    {
        [$m,$user,$host,$guest] = $this->room();
        $this->withSession(['rooms' => [$m->id => $guest]])->postJson('/m/'.$m->code.'/reaction', ['emoji' => '🎉'])->assertNoContent();
        $this->postJson('/m/'.$m->code.'/reaction', ['emoji' => '<script>'])->assertUnprocessable();
        $this->withSession(['rooms' => [$m->id => $host]])->getJson('/m/'.$m->code.'/poll')->assertJsonPath('activity.0.emoji', '🎉');
        DB::table('participants')->where('id', $guest)->update(['status' => 'waiting']);
        $this->withSession(['rooms' => [$m->id => $guest]])->getJson('/m/'.$m->code.'/poll')->assertJsonCount(0, 'activity');
        $this->postJson('/m/'.$m->code.'/reaction', ['emoji' => '👍'])->assertForbidden();
    }

    public function test_language_is_persisted_and_pages_and_validation_are_arabic(): void
    {
        $this->postJson('/language/ar')->assertOk();
        $this->get('/')->assertOk()->assertSee('dir="rtl"', false)->assertSee('أقرب إلى بعضنا.');
        $this->get('/register')->assertSee('إنشاء حساب')->assertSee('البريد الإلكتروني');
        $this->postJson('/register', [])->assertUnprocessable()->assertJsonPath('errors.name.0', 'حقل الاسم مطلوب.');
        $this->postJson('/language/fr')->assertNotFound();
        $this->postJson('/language/en')->assertOk();
        $this->get('/')->assertSee('dir="ltr"', false);
    }

    public function test_translation_catalogs_cover_the_same_keys(): void
    {
        $en = json_decode(file_get_contents(lang_path('en.json')), true);
        $ar = json_decode(file_get_contents(lang_path('ar.json')), true);
        $this->assertEqualsCanonicalizing(array_keys($en), array_keys($ar));
        foreach ($ar as $key => $value) {
            if (! in_array($key, ['Gather', ' — Gather'])) {
                $this->assertMatchesRegularExpression('/[\x{0600}-\x{06ff}]/u',$value,$key);
            }
        }
    }
}
