<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('meetings', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->string('code', 14)->unique();
            $t->string('title', 120);
            $t->text('description')->nullable();
            $t->timestamp('scheduled_at')->nullable();
            $t->unsignedSmallInteger('duration')->default(30);
            $t->boolean('waiting_room')->default(true);
            $t->boolean('locked')->default(false);
            $t->timestamp('ended_at')->nullable();
            $t->timestamps();
        });
        Schema::create('participants', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignId('meeting_id')->constrained()->cascadeOnDelete();
            $t->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $t->string('name', 60);
            $t->string('status', 16)->default('waiting');
            $t->boolean('is_host')->default(false);
            foreach (['audio', 'video', 'hand', 'sharing'] as $field) {
                $t->boolean($field)->default(false);
            }
            $t->timestamp('last_seen')->index();
            $t->timestamps();
            $t->index(['meeting_id', 'status']);
        });
        Schema::create('meeting_events', function (Blueprint $t) {
            $t->id();
            $t->foreignId('meeting_id')->constrained()->cascadeOnDelete();
            $t->uuid('sender');
            $t->uuid('target');
            $t->string('type', 20);
            $t->text('payload');
            $t->timestamp('created_at');
            $t->index(['meeting_id', 'id']);
        });
        Schema::create('messages', function (Blueprint $t) {
            $t->id();
            $t->foreignId('meeting_id')->constrained()->cascadeOnDelete();
            $t->uuid('participant_id');
            $t->string('name', 60);
            $t->text('body');
            $t->timestamp('created_at');
            $t->index(['meeting_id', 'id']);
        });
    }

    public function down(): void
    {
        foreach (['messages', 'meeting_events', 'participants', 'meetings'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
