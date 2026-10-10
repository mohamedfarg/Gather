@extends('layout')
@section('title', __('Settings — Gather'))
@section('content')
<div class="app-shell">
    @include('partials.sidebar')
    <main class="main-area">
        <header class="topbar">{{ __('Workspace') }} <span class="crumb">/</span> {{ __('Settings') }}</header>
        <div class="page-content">
            <div class="page-heading"><div><span class="eyebrow">{{ __('MAKE YOURSELF AT HOME') }}</span><h1>{{ __('Your settings.') }}</h1><p>{{ __('A few details to make this space yours.') }}</p></div></div>
            @include('partials.alerts')
            <section class="settings-card">
                <h2>{{ __('Profile & account') }}</h2>
                <form method="post" action="{{ route('settings') }}">
                    @csrf
                    @method('PATCH')
                    <label for="name">{{ __('Display name') }}</label>
                    <input id="name" name="name" value="{{ old('name',auth()->user()->name) }}" required maxlength="60">
                    <label for="email">{{ __('Email address') }}</label>
                    <input type="email" id="email" name="email" value="{{ old('email',auth()->user()->email) }}" required>
                    <label for="current_password">{{ __('Current password') }}</label>
                    <input type="password" id="current_password" name="current_password" autocomplete="current-password" required>
                    <p class="field-help">{{ __('Confirm your password to save account changes.') }}</p>
                    <label for="password">{{ __('New password') }} <span class="muted">{{ __('(optional)') }}</span></label>
                    <input type="password" id="password" name="password" minlength="10" autocomplete="new-password">
                    <label for="password_confirmation">{{ __('Confirm new password') }}</label>
                    <input type="password" id="password_confirmation" name="password_confirmation" autocomplete="new-password">
                    <button class="button primary">{{ __('Save changes') }}<x-icon name="check"/></button>
                </form>
                <form method="post" action="{{ route('logout') }}">
                    @csrf
                    <button class="button outline"><x-icon name="logout"/>{{ __('Sign out') }}</button>
                </form>
            </section>
        </div>
    </main>
</div>
@endsection
