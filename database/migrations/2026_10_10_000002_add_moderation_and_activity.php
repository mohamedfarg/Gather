<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('meetings', fn (Blueprint $t) => $t->boolean('moderated')->default(false));
        Schema::table('participants', fn (Blueprint $t) => $t->boolean('audio_locked')->default(false));
        Schema::create('room_activity', function (Blueprint $t) {
            $t->id();
            $t->foreignId('meeting_id')->constrained()->cascadeOnDelete();
            $t->uuid('participant_id');
            $t->string('name', 60);
            $t->string('emoji', 16);
            $t->timestamp('created_at');
            $t->index(['meeting_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('room_activity');
        Schema::table('participants', fn (Blueprint $t) => $t->dropColumn('audio_locked'));
        Schema::table('meetings', fn (Blueprint $t) => $t->dropColumn('moderated'));
    }
};
