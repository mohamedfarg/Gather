<aside class="sidebar">
@include('partials.brand')
<div class="workspace-label">{{ __('YOUR WORKSPACE') }}</div>
<nav class="side-nav" aria-label="{{ __('Main navigation') }}">
<a href="{{ route('dashboard') }}" @class(['active'=>request()->routeIs('dashboard') && !request('view')])><x-icon name="grid"/>{{ __('Overview') }}</a>
<a href="{{ route('dashboard', ['view'=>'history']) }}" @class(['active'=>request('view')==='history'])><x-icon name="clock"/>{{ __('Meeting history') }}</a>
<a href="{{ route('settings') }}" @class(['active'=>request()->routeIs('settings')])><x-icon name="settings"/>{{ __('Settings') }}</a>
</nav>
<div class="sidebar-bottom"><div class="private-card"><x-icon name="shield"/><strong>{{ __('Your space. Your conversations.') }}</strong><p>{{ __('Hosted on your infrastructure.') }}<br>{{ __('A little more peace of mind.') }}</p><span class="status-dot"></span> {{ __('Self-hosted workspace') }}</div>
<div class="profile"><span class="avatar">{{ mb_strtoupper(mb_substr(auth()->user()->name,0,1)) }}</span><div><strong>{{ auth()->user()->name }}</strong><small>{{ __('Personal workspace') }}</small></div><form method="post" action="{{ route('logout') }}">@csrf<button class="icon-button" aria-label="{{ __('Sign out') }}" title="{{ __('Sign out') }}"><x-icon name="logout"/></button></form></div></div>
</aside>
