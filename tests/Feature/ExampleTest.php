<?php

namespace Tests\Feature;

use Tests\TestCase;

class ExampleTest extends TestCase
{
    public function test_the_public_landing_page_renders_and_links_to_registration(): void
    {
        $response = $this->get('/');

        $response->assertOk()->assertSee('A little closer.')->assertSee(route('register'))->assertSee('/vendor/jquery-3.7.1.min.js');
    }
}
