<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function form(Request $r)
    {
        return view('auth', ['register' => $r->routeIs('register')]);
    }

    public function register(Request $r)
    {
        $data = $r->validate(['name' => 'required|string|max:60', 'email' => 'required|email|max:254|unique:users', 'password' => ['required', 'confirmed', Password::min(10)]]);
        Auth::login(User::create($data));
        $r->session()->regenerate();

        return redirect()->route('dashboard');
    }

    public function login(Request $r)
    {
        $data = $r->validate(['email' => 'required|email', 'password' => 'required|string']);
        if (! Auth::attempt($data, $r->boolean('remember'))) {
            throw ValidationException::withMessages(['email' => __('The email or password is incorrect.')]);
        }
        $r->session()->regenerate();

        return redirect()->intended(route('dashboard'));
    }

    public function logout(Request $r)
    {
        Auth::logout();
        $r->session()->invalidate();
        $r->session()->regenerateToken();

        return redirect()->route('home');
    }

    public function settings()
    {
        return view('settings');
    }

    public function update(Request $r)
    {
        $data = $r->validate(['name' => 'required|string|max:60', 'email' => ['required', 'email', 'max:254', Rule::unique('users')->ignore($r->user()->id)], 'current_password' => 'required|current_password', 'password' => ['nullable', 'confirmed', Password::min(10)]]);
        unset($data['current_password']);
        if (empty($data['password'])) {
            unset($data['password']);
        }
        $r->user()->update($data);

        return back()->with('success', __('Your profile has been updated.'));
    }
}
