<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;

class RoomChanged implements ShouldBroadcast
{
    public function __construct(public string $code) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('meeting.'.$this->code)];
    }

    public function broadcastAs(): string
    {
        return 'room.changed';
    }
}
