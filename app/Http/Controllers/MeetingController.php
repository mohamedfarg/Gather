<?php

namespace App\Http\Controllers;

use App\Models\Meeting;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class MeetingController extends Controller
{
    public function home()
    {
        return auth()->check() ? redirect()->route('dashboard') : view('welcome');
    }

    public function dashboard(Request $r)
    {
        $q = Meeting::where('user_id', $r->user()->id);
        $history = $r->query('view') === 'history';
        $meetings = (clone $q)->when($history, fn ($q) => $q->whereNotNull('ended_at'), fn ($q) => $q->whereNull('ended_at'))->orderByRaw('scheduled_at IS NULL DESC')->orderBy('scheduled_at')->paginate(9)->withQueryString();

        return view('dashboard', compact('meetings', 'history') + ['total' => (clone $q)->count(), 'upcoming' => (clone $q)->whereNull('ended_at')->count(), 'completed' => (clone $q)->whereNotNull('ended_at')->count()]);
    }

    public function store(Request $r)
    {
        $data = $r->validate(['title' => 'required|string|max:120', 'description' => 'nullable|string|max:1000', 'scheduled_at' => 'nullable|date|after:now', 'duration' => 'required|integer|min:15|max:480', 'waiting_room' => 'nullable|boolean', 'instant' => 'nullable|boolean']);
        $instant = $r->boolean('instant');
        unset($data['instant']);
        if (! empty($data['scheduled_at'])) {
            $data['scheduled_at'] = Carbon::parse($data['scheduled_at'])->utc();
        }
        $m = Meeting::create($data + ['user_id' => $r->user()->id, 'code' => strtolower(Str::random(4).'-'.Str::random(4).'-'.Str::random(4))]);

        return $instant ? redirect()->route('room', $m->code) : redirect()->route('dashboard')->with('success', __('Meeting scheduled. Copy the invitation link to share it.'));
    }

    public function join(Request $r)
    {
        $data = $r->validate(['code' => 'required|string|max:300']);
        $code = strtolower(trim(basename(parse_url($data['code'], PHP_URL_PATH) ?: $data['code'])));
        if (! preg_match('/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/', $code) || ! Meeting::where('code', $code)->whereNull('ended_at')->exists()) {
            return back()->withErrors(['code' => __('No open meeting found. Check the code or invitation link.')]);
        }

        return redirect()->route('room', $code);
    }

    public function destroy(Request $r, Meeting $meeting)
    {
        abort_unless($meeting->user_id === $r->user()->id, 403);
        $meeting->update(['ended_at' => now()]);

        return redirect()->route('dashboard')->with('success', __('Meeting closed. It is now in your history.'));
    }
}
