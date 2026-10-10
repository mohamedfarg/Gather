<?php

return [
    'required' => 'حقل :attribute مطلوب.',
    'required_if' => 'حقل :attribute مطلوب عند اختيار :value.',
    'string' => 'يجب أن يكون :attribute نصًا.',
    'email' => 'أدخل بريدًا إلكترونيًا صالحًا.',
    'unique' => 'قيمة :attribute مستخدمة بالفعل.',
    'confirmed' => 'تأكيد :attribute غير مطابق.',
    'current_password' => 'كلمة المرور الحالية غير صحيحة.',
    'integer' => 'يجب أن يكون :attribute عددًا صحيحًا.',
    'boolean' => 'قيمة :attribute غير صالحة.',
    'date' => 'أدخل تاريخًا صالحًا في :attribute.',
    'after' => 'يجب أن يكون :attribute بعد :date.',
    'in' => 'القيمة المختارة في :attribute غير صالحة.',
    'uuid' => 'معرّف :attribute غير صالح.',
    'array' => 'صيغة :attribute غير صالحة.',
    'max' => ['string' => 'يجب ألا يتجاوز :attribute :max حرفًا.', 'numeric' => 'يجب ألا يزيد :attribute على :max.', 'array' => 'يجب ألا يحتوي :attribute على أكثر من :max عناصر.'],
    'min' => ['string' => 'يجب ألا يقل :attribute عن :min أحرف.', 'numeric' => 'يجب ألا يقل :attribute عن :min.', 'array' => 'يجب أن يحتوي :attribute على :min عناصر على الأقل.'],
    'attributes' => ['name' => 'الاسم', 'email' => 'البريد الإلكتروني', 'password' => 'كلمة المرور', 'password_confirmation' => 'تأكيد كلمة المرور', 'current_password' => 'كلمة المرور الحالية', 'title' => 'اسم الاجتماع', 'description' => 'موضوع الاجتماع', 'scheduled_at' => 'موعد الاجتماع', 'duration' => 'المدة', 'code' => 'رمز الاجتماع', 'body' => 'الرسالة', 'target' => 'المشارك', 'emoji' => 'التفاعل', 'audio' => 'الميكروفون', 'video' => 'الكاميرا', 'hand' => 'رفع اليد', 'sharing' => 'مشاركة الشاشة', 'action' => 'الإجراء', 'cursor' => 'مؤشر البيانات', 'payload' => 'بيانات الاتصال', 'type' => 'نوع البيانات', 'waiting_room' => 'غرفة الانتظار'],
];
