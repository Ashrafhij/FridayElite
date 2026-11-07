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
  [/INVALID_EXTERNAL_PLAYER_NAME/, 'أدخل اسم اللاعب الخارجي (حرفان على الأقل).'],
  [/INVALID_IMAGE_TYPE/, 'اختر صورة بصيغة JPG أو PNG أو WebP.'],
  [
    /IMAGE_TOO_LARGE|object exceeded the maximum allowed size|payload too large/i,
    'حجم الصورة كبير. الحد الأقصى 5 ميجابايت.',
  ],
  [/IMAGE_PROCESSING_FAILED|IMAGE_REQUIRED/, 'تعذر معالجة الصورة. جرّب صورة أخرى.'],
  [/REGISTRATION_NOT_OPEN/, 'التسجيل لم يفتح بعد. يفتح الخميس الساعة ١٠:٠٠ صباحًا.'],
  [
    /REGISTRATION_CLOSED|REGISTRATION_LOCKED/,
    'انتهت فترة التسجيل. التسجيل مفتوح من الخميس ١٠:٠٠ حتى الجمعة ٢٠:٠٠.',
  ],
  [/MATCH_NOT_FOUND/, 'لم يتم العثور على المباراة.'],
  [/REGISTRATION_NOT_FOUND/, 'لم يتم العثور على هذا التسجيل.'],
  [/ALREADY_CANCELLED/, 'تم إلغاء هذا التسجيل بالفعل.'],
  [/CANCELLATION_CLOSED/, 'لا يمكن إلغاء التسجيل بعد انطلاق المباراة.'],
  [/ALREADY_REGISTERED/, 'أنت مسجّل في هذه المباراة بالفعل.'],
  [/INVALID_REGISTRATION_WINDOW/, 'وقت فتح التسجيل يجب أن يكون قبل إغلاقه وقبل انطلاق المباراة.'],
  [/INVALID_CONFIRMED_COUNT/, 'يُفعّل توليد الفرق عند اكتمال 18 لاعبًا مؤكدًا.'],
  [/SAME_PLAYER/, 'اختر لاعبين مختلفين للمبادلة.'],
  [/ASSIGNMENT_NOT_FOUND/, 'أحد اللاعبين غير موجود في توزيع الفريقين.'],
  [/GK_SWAP_NOT_ALLOWED/, 'لا يمكن تبديل حارس المرمى مع لاعب ميدان.'],
  [/INVALID_TEAM_COLOR/, 'اختر لونًا صالحًا لكل فريق.'],
  [/TEAMS_NOT_GENERATED/, 'أنشئ توزيع الفريقين أولًا.'],
  [/PLAYER_NOT_ASSIGNED/, 'هذا اللاعب غير موجود في توزيع الفريقين.'],
  [/INVALID_MATCH_STATS/, 'أدخل الأهداف والتمريرات بين 0 و30.'],
  [/MATCH_NOT_COMPLETED/, 'يمكن التقييم بعد اكتمال المباراة فقط.'],
  [/CANNOT_RATE_SELF/, 'لا يمكنك تقييم نفسك.'],
  [/INVALID_RATING/, 'التقييم يجب أن يكون بين 1 و10.'],
  [/NOT_MATCH_PARTICIPANT/, 'فقط اللاعبون المشاركون في المباراة يمكن تقييمهم.'],
  [/INVALID_SCORE|INVALID_SCORERS|INVALID_SCORER_PLAYER/, 'تحقق من النتيجة والهدافين قبل الحفظ.'],
  [/RESULT_SCORE_MISMATCH/, 'أهداف الهدافين لا تطابق النتيجة النهائية.'],
  [
    /INVALID_ROSTER_COMPOSITION/,
    'تشكيلة اللاعبين لا تسمح بالتوزيع: يلزم حارسان مرمى و16 لاعب ميدان.',
  ],
  [/UNSUPPORTED_FORMATION/, 'توزيع الفرق مدعوم فقط بتشكيلة 1-3-3-2.'],
  [/MATCH_CLOSED|MATCH_ALREADY_COMPLETED/, 'هذه المباراة مكتملة ولا يمكن تغيير فرقها.'],
  [
    /duplicate key|unique constraint|matches_local_date_uidx/i,
    'توجد مباراة في هذا التاريخ بالفعل. اختر تاريخًا آخر للمباراة.',
  ],
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
