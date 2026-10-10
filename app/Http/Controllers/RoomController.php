<?php

namespace App\Http\Controllers;

use App\Models\Meeting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class RoomController extends Controller
{
    private function participant(Request $r, Meeting $m, bool $admitted = true)
    {
        $p = DB::table('participants')->where('meeting_id', $m->id)->where('id', $r->session()->get('rooms.'.$m->id))->first();
        abort_unless($p, 403, __('Join the meeting first.'));
        abort_if($m->ended_at, 410, __('The host ended this meeting.'));
        abort_if(in_array($p->status, ['left', 'removed']), 403, __('You are no longer in this meeting.'));
        abort_if($admitted && $p->status !== 'admitted', 403, __('Wait for the host to admit you.'));

        return $p;
    }

    private function peers(Meeting $m)
    {
        return DB::table('participants')->where('meeting_id', $m->id)->where('last_seen', '>', now()->subSeconds(45))->whereIn('status', ['waiting', 'admitted']);
    }

    public function show(Meeting $meeting)
    {
        return view('room', ['meeting' => $meeting->load('host')]);
    }

    public function enter(Request $r, Meeting $meeting)
    {
        $data = $r->validate(['name' => 'required|string|max:60', 'audio' => 'required|boolean', 'video' => 'required|boolean']);
        $p = DB::transaction(function () use ($r, $meeting, $data) {
            $m = Meeting::whereKey($meeting->id)->lockForUpdate()->firstOrFail();
            abort_if($m->ended_at, 410, __('This meeting has ended.'));
            $host = $r->user()?->id === $m->user_id;
            $old = DB::table('participants')->where('meeting_id', $m->id)->where('id', $r->session()->get('rooms.'.$m->id))->first();
            abort_if($old?->status === 'removed', 403, __('The host removed you from this meeting.'));
            abort_if($m->locked && ! $host, 423, __('The host has locked this meeting.'));
            $others = $this->peers($m)->where('id', '!=', $old?->id ?? '');
            abort_if((clone $others)->count() >= config('meeting.capacity') || (! $host && (clone $others)->where('is_host', false)->count() >= config('meeting.capacity') - 1), 409, __('This room is full (8 participants, including the host).'));
            if ($old) {
                DB::table('participants')->where('id', $old->id)->update(['status' => 'left']);
            }
            $id = (string) Str::uuid();
            if (! $host && $m->moderated) {
                $data['audio'] = false;
            }
            DB::table('participants')->insert($data + ['id' => $id, 'meeting_id' => $m->id, 'audio_locked' => ! $host && $m->moderated, 'user_id' => $r->user()?->id, 'is_host' => $host, 'status' => $host || ! $m->waiting_room ? 'admitted' : 'waiting', 'last_seen' => now(), 'created_at' => now(), 'updated_at' => now()]);
            $r->session()->put('rooms.'.$m->id, $id);

            return DB::table('participants')->where('id', $id)->first();
        });
        $ice = [];
        if (config('meeting.stun_url')) {
            $ice[] = ['urls' => config('meeting.stun_url')];
        }
        if (config('meeting.turn_urls') && config('meeting.turn_secret')) {
            $username = (now()->timestamp + 86400).':'.$p->id;
            $ice[] = ['urls' => config('meeting.turn_urls'), 'username' => $username, 'credential' => base64_encode(hash_hmac('sha1', $username, config('meeting.turn_secret'), true))];
        }

        return response()->json(['participant' => $p, 'iceServers' => $ice]);
    }

    public function poll(Request $r, Meeting $meeting)
    {
        $r->validate(['cursor' => 'nullable|integer|min:0', 'message_cursor' => 'nullable|integer|min:0', 'activity_cursor' => 'nullable|integer|min:0']);
        $me = $this->participant($r, $meeting, false);
        DB::table('participants')->where('id', $me->id)->update(['last_seen' => now()]);
        $participants = $this->peers($meeting)->when(! $me->is_host, fn ($q) => $q->where('status', 'admitted'))->get();
        $events = collect();
        $messages = collect();
        $activity = collect();
        if ($me->status === 'admitted') {
            $events = DB::table('meeting_events')->where('meeting_id', $meeting->id)->where('id', '>', $r->integer('cursor'))->orderBy('id')->limit(200)->get();
            $messages = DB::table('messages')->where('meeting_id', $meeting->id)->where('id', '>', $r->integer('message_cursor'))->orderBy('id')->limit(100)->get();
            $activity = DB::table('room_activity')->where('meeting_id', $meeting->id)->where('id', '>', $r->integer('activity_cursor'))->where('created_at', '>', now()->subSeconds(10))->orderBy('id')->limit(100)->get();
        }

        return response()->json(['me' => $me, 'participants' => $participants, 'locked' => $meeting->locked, 'moderated' => (bool) $meeting->moderated, 'events' => $events->where('target', $me->id)->values(), 'cursor' => $events->last()?->id ?? $r->integer('cursor'), 'messages' => $messages, 'activity' => $activity]);
    }

    public function signal(Request $r, Meeting $meeting)
    {
        $me = $this->participant($r, $meeting);
        $data = $r->validate(['target' => 'required|uuid', 'type' => 'required|in:offer,answer,ice', 'payload' => 'required|array']);
        abort_if(strlen(json_encode($data['payload'])) > 65536, 422, __('Signal is too large.'));
        abort_unless($this->peers($meeting)->where('status', 'admitted')->where('id', $data['target'])->where('id', '!=', $me->id)->exists(), 422, __('Participant unavailable.'));
        DB::table('meeting_events')->insert(['meeting_id' => $meeting->id, 'sender' => $me->id, 'target' => $data['target'], 'type' => $data['type'], 'payload' => json_encode($data['payload']), 'created_at' => now()]);

        return response()->noContent();
    }

    public function chat(Request $r, Meeting $meeting)
    {
        $me = $this->participant($r, $meeting);
        $data = $r->validate(['body' => 'required|string|max:2000']);
        DB::table('messages')->insert(['meeting_id' => $meeting->id, 'participant_id' => $me->id, 'name' => $me->name, 'body' => trim($data['body']), 'created_at' => now()]);

        return response()->noContent();
    }

    public function state(Request $r, Meeting $meeting)
    {
        $me = $this->participant($r, $meeting);
        $data = $r->validate(['audio' => 'sometimes|boolean', 'video' => 'sometimes|boolean', 'hand' => 'sometimes|boolean', 'sharing' => 'sometimes|boolean']);
        abort_if($me->audio_locked && ! empty($data['audio']), 403, __('The host has muted your microphone. Raise your hand to request permission to speak.'));
        DB::table('participants')->where('id', $me->id)->update($data + ['updated_at' => now()]);

        return response()->noContent();
    }

    public function leave(Request $r, Meeting $meeting)
    {
        DB::table('participants')->where('meeting_id', $meeting->id)->where('id', $r->session()->get('rooms.'.$meeting->id))->where('status', '!=', 'removed')->update(['status' => 'left']);

        return response()->noContent();
    }

    public function control(Request $r, Meeting $meeting)
    {
        $me = $this->participant($r, $meeting);
        abort_unless($me->is_host && $r->user()?->id === $meeting->user_id, 403);
        $data = $r->validate(['action' => 'required|in:admit,remove,lock,end,mute_all,allow_all,mute,allow', 'target' => 'required_if:action,admit,remove,mute,allow|uuid']);
        if ($data['action'] === 'end') {
            $meeting->update(['ended_at' => now()]);
        } elseif ($data['action'] === 'lock') {
            $meeting->update(['locked' => ! $meeting->locked]);
        } elseif (in_array($data['action'], ['mute_all', 'allow_all'])) {
            DB::transaction(function () use ($meeting, $data) {
                $locked = $data['action'] === 'mute_all';
                Meeting::whereKey($meeting->id)->lockForUpdate()->firstOrFail()->update(['moderated' => $locked]);
                DB::table('participants')->where('meeting_id', $meeting->id)->where('is_host', false)->whereIn('status', ['waiting', 'admitted'])->update($locked ? ['audio_locked' => true, 'audio' => false] : ['audio_locked' => false]);
            });
        } else {
            DB::transaction(function () use ($meeting, $data, $me) {
                Meeting::whereKey($meeting->id)->lockForUpdate()->firstOrFail();
                $target = DB::table('participants')->where('meeting_id', $meeting->id)->where('id', $data['target'])->where('id', '!=', $me->id)->where('is_host', false)->first();
                abort_unless($target, 404);
                abort_if($data['action'] === 'admit' && $target->status !== 'waiting', 422);
                $changes = match ($data['action']) {
                    'admit' => ['status' => 'admitted'],
                    'remove' => ['status' => 'removed'],
                    'mute' => ['audio_locked' => true, 'audio' => false],
                    'allow' => ['audio_locked' => false, 'hand' => false],
                };
                DB::table('participants')->where('id', $target->id)->update($changes);
            });
        }

        return response()->noContent();
    }

    public function reaction(Request $r, Meeting $meeting)
    {
        $me = $this->participant($r, $meeting);
        $data = $r->validate(['emoji' => 'required|in:👍,👏,❤️,😂,🎉,🤔']);
        DB::table('room_activity')->insert(['meeting_id' => $meeting->id, 'participant_id' => $me->id, 'name' => $me->name, 'emoji' => $data['emoji'], 'created_at' => now()]);

        return response()->noContent();
    }
}
