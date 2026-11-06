const ERROR_MESSAGES = [
  // Stable codes returned by the phone-auth Edge Functions (checked first).
  [/ACCOUNT_EXISTS/, 'رقم الهاتف مسجل مسبقًا. جرّب تسجيل الدخول.'],
  [/INVALID_CREDENTIALS/, 'رقم الهاتف أو كلمة المرور غير صحيحة.'],
  [/INVALID_PHONE/, 'رقم الهاتف غير صالح. استخدم الصيغة الدولية E.164.'],
  [/WEAK_PASSWORD/, 'كلمة المرور يجب أن تكون بين 8 و72 حرفًا.'],
  [/INVALID_NAME/, 'الاسم يجب أن يكون بين حرفين و80 حرفًا.'],
  [/RATE_LIMITED/, 'محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.'],
  [/INVALID_INPUT|METHOD_NOT_ALLOWED/, 'تعذر إكمال العملية. حاول مرة أخرى.'],
  [/SERVER_ERROR/, 'تعذر إكمال العملية. حاول مرة أخرى.'],
  [/INVALID_AVATAR/, 'رابط الصورة غير صالح. أعد رفع الصورة الشخصية.'],
  [/INVALID_IMAGE_TYPE/, 'اختر صورة بصيغة JPG أو PNG أو WebP.'],
  [
    /IMAGE_TOO_LARGE|object exceeded the maximum allowed size|payload too large/i,
    'حجم الصورة كبير. الحد الأقصى 5 ميجابايت.',
  ],
  [/IMAGE_PROCESSING_FAILED|IMAGE_REQUIRED/, 'تعذر معالجة الصورة. جرّب صورة أخرى.'],
  [
    /bucket not found|bucket.*not found/i,
    'مساحة الصور غير مهيأة. طبّق تحديث قاعدة البيانات 0003 أولًا.',
  ],

  // The function is not deployed / the project URL is wrong.
  [
    /failed to send a request to the edge function|failed to fetch|networkerror/i,
    'تعذر الاتصال بخادم المصادقة. تحقق من نشر وظائف Supabase وحاول مجددًا.',
  ],

  // Legacy Supabase Auth messages (kept for older flows and clearer errors).
  [/account already exists/i, 'حساب موجود بالفعل'],
  [/invalid login credentials/i, 'رقم الهاتف أو كلمة المرور غير صحيحة.'],
  [/phone not confirmed/i, 'رقم الهاتف غير مؤكد. إعدادات المشروع ما زالت تطلب تأكيد الهاتف.'],
  [/phone signups are disabled/i, 'تسجيل الدخول بالهاتف غير مفعّل في إعدادات المشروع.'],
  [/signups not allowed|signup.*disabled/i, 'التسجيل العام غير مفعّل في إعدادات المشروع.'],
  [/user already registered|already registered/i, 'رقم الهاتف مسجل مسبقًا. جرّب تسجيل الدخول.'],
  [/password should be at least|password.*too short/i, 'كلمة المرور قصيرة. استخدم 8 أحرف على الأقل.'],
  [/invalid phone|phone not registered/i, 'رقم الهاتف غير صالح. استخدم الصيغة الدولية E.164.'],
  [/rate limit|too many requests|for security purposes/i, 'محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.'],
  [/network|fetch|failed to fetch/i, 'تعذر الاتصال بالخادم. تحقق من الشبكة وحاول مجددًا.'],
  [/PHONE_REQUIRED/i, 'رقم الهاتف مطلوب وغير صالح. تواصل مع الإدارة.'],
  [/PHONE_CHANGE_REQUIRES_ADMIN/i, 'تغيير رقم الهاتف يتطلب إجراءً إداريًا محميًا.'],
  [/JERSEY_TAKEN/i, 'رقم القميص محجوز للاعب مؤكد آخر. اختر رقمًا مختلفًا.'],
  [/ACCOUNT_NOT_APPROVED/i, 'حسابك ما زال بانتظار موافقة الإدارة.'],
  [/ACCOUNT_NOT_ACTIVE/i, 'حسابك غير مفعّل لتعديل الملف الشخصي.'],
  [/INVALID_NAME/i, 'الاسم يجب أن يكون بين حرفين و80 حرفًا.'],
  [/INVALID_PREFERRED_FOOT/i, 'اختر القدم المفضلة بشكل صحيح.'],
  [/INVALID_JERSEY_NUMBER/i, 'رقم القميص يجب أن يكون بين 1 و99.'],
  [/POSITIONS_REQUIRED/i, 'اختر مركزًا واحدًا على الأقل.'],
  [/TOO_MANY_POSITIONS/i, 'يمكنك اختيار 5 مراكز كحد أقصى.'],
  [/INVALID_POSITION/i, 'أحد المراكز المختارة غير صالح.'],
  [/DUPLICATE_POSITION/i, 'لا يمكن تكرار المركز نفسه.'],
  [/PLAYER_NOT_FOUND/i, 'لم يتم العثور على اللاعب.'],
  [/ALREADY_APPROVED/i, 'الحساب موافق عليه بالفعل.'],
  [/CANNOT_MODIFY_ADMIN/i, 'لا يمكن تعديل حساب إداري من هذه الصفحة.'],
  [/CANNOT_MODIFY_SELF/i, 'لا يمكنك تنفيذ هذا الإجراء على حسابك.'],
  [/USE_SUSPEND_FOR_APPROVED_PLAYERS/i, 'استخدم تعليق الحساب للاعب الموافق عليه.'],
  [/PERMISSION|FORBIDDEN|row-level security/i, 'ليست لديك صلاحية لتنفيذ هذا الإجراء.'],
]

/**
 * Keeps user-facing errors Arabic. Unknown server errors fall back to a safe,
 * generic Arabic message rather than exposing raw backend text.
 */
export function toArabicError(error, fallback = 'تعذر إكمال العملية. حاول مرة أخرى.') {
  const raw = typeof error === 'string' ? error : error?.message || ''
  const code = error?.code || ''

  const match = ERROR_MESSAGES.find(([pattern]) => pattern.test(code) || pattern.test(raw))
  if (match) return match[1]

  if (/[\u0600-\u06FF]/.test(raw)) return raw

  return fallback
}
