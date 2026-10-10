<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Meeting extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['scheduled_at' => 'datetime', 'ended_at' => 'datetime', 'waiting_room' => 'boolean', 'locked' => 'boolean', 'moderated' => 'boolean'];
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
