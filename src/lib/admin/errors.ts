// ADMIN ERROR VOICE — Arabic messages for anything the admin UI shows.
//
// The server owns the error CONTRACT (code + details); the server's own
// wording is English. The admin panel must not show English, and the server
// strings are not part of the product surface we may change here, so this
// module TRANSLATES the known server messages for display and falls back to a
// clear Arabic sentence per error code.
//
// Rules:
// - Never echo an unknown English message to the screen.
// - Always say what happened AND what to do next.
// - No technical identifiers in the sentence.

import type { AppError } from "@/lib/frontend/api-client";

/** Exact server message → the Arabic sentence the operator reads. */
const MESSAGE_TRANSLATIONS: Record<string, string> = {
  "Forbidden.": "حسابك مش مسموح له بالخطوة دي. كلّم مالك المتجر لو محتاج الصلاحية.",
  "Authentication is required.": "محتاج تسجّل دخول الأول.",
  "Authentication required.": "محتاج تسجّل دخول الأول.",
  "Too many requests.": "عملت طلبات كتير في وقت قصير. استنى شوية وحاول تاني.",
  "Unexpected error.": "حصلت مشكلة في الخادم. حاول تاني، ولو كررت كلّم مالك المتجر.",

  "Invalid query.": "الفلتر اللي اتبعت مش مظبوط. عدّله وحاول تاني.",
  "Invalid request body.": "البيانات المرسلة مش مظبوطة. راجع الحقول وحاول تاني.",
  "Invalid pagination cursor.": "رابط الصفحة اللي فتحته قديم. ابدأ من أول القائمة.",
  "Invalid search cursor.": "رابط البحث اللي فتحته قديم. ابدأ من أول النتائج.",
  "Search query is required.": "اكتب كلمة البحث الأول.",
  "Empty patch: no field to update.": "مفيش حاجة اتغيرت. عدّل حقل واحد على الأقل.",
  "Invalid password.": "كلمة السر مش مظبوطة. لازم تكون 12 حرف على الأقل.",
  "Invalid registration.": "بيانات التسجيل مش مظبوطة. راجع الاسم والتليفون والبريد.",
  "Guest checkout context is required.": "سلة الطلب مش متعرّف عليها. افتح المتجر تاني وابدأ من جديد.",
  "Guest checkout session is no longer valid.": "جلسة سلة الطلب انتهت. افتح المتجر تاني.",
  "Guest order access has expired.": "رابط الوصول للطلب انتهت صلاحيته. اطلب من العميل رقم الطلب.",
  "Exactly one of guest token / customer session is required.": "الطلب لازم يكون من زائر أو من عميل مسجّل، مش الاتنين.",

  // catalogue
  "Invalid product.": "بيانات المنتج مش مظبوطة. راجع الاسم والسعر والتصنيف.",
  "Invalid product id.": "رقم المنتج اللي في الرابط مش مظبوط.",
  "Product not found.": "المنتج ده مش موجود، أو اتشال.",
  "Invalid variant.": "بيانات الشكل البيعي مش مظبوطة. راجع الاسم والسعر.",
  "Invalid variant id.": "رقم الشكل البيعي اللي في الرابط مش مظبوط.",
  "Variant not found.": "الشكل البيعي ده مش موجود.",
  "Invalid category.": "بيانات التصنيف مش مظبوطة. لازم يكون فيه اسم.",
  "Invalid category id.": "رقم التصنيف اللي في الرابط مش مظبوط.",
  "Category not found.": "التصنيف ده مش موجود.",
  "Invalid brand.": "بيانات العلامة التجارية مش مظبوطة. لازم يكون فيها اسم.",
  "Invalid brand id.": "رقم العلامة التجارية اللي في الرابط مش مظبوط.",
  "Brand not found.": "العلامة التجارية دي مش موجودة.",
  "Invalid product code.": "الكود مش مظبوط. الباركود لازم يكون أرقام بس، والكود الداخلي من غير مسافات.",
  "Product code not found.": "الكود ده مش موجود.",
  "Invalid code id.": "رقم الكود اللي في الرابط مش مظبوط.",
  "Invalid image.": "بيانات الصورة مش مظبوطة. راجع الرابط والصورة.",
  "Invalid image id.": "رقم الصورة اللي في الرابط مش مظبوط.",
  "Image not found.": "الصورة دي مش موجودة.",
  "Invalid price.": "السعر مش مظبوط. لازم يكون رقم موجب.",
  "Invalid price window.": "السعر قبل الخصم لازم يكون أكبر من السعر بعد الخصم.",

  // inventory
  "Invalid adjustment.": "بيانات التسوية مش مظبوطة. راجع نوع التسوية والكمية.",
  "Invalid threshold.": "حد التنبيه مش مظبوط. لازم يكون رقم من صفر لفوق.",
  "Invalid inventory initialization.": "كمية المخزون الأولية مش مظبوطة.",
  "Inventory not found.": "صنف المخزون ده مش موجود.",
  "Invalid movement id.": "رقم الحركة في المخزون مش مظبوط.",
  "Movement not found.": "حركة المخزون دي مش موجودة.",
  "Invalid commit.": "بيانات الخصم من المخزون مش مظبوطة.",
  "Invalid release.": "بيانات تحرير الكمية المحجوزة مش مظبوطة.",
  "Invalid reservation.": "بيانات حجز الكمية مش مظبوطة.",
  "Invalid pick.": "كمية التجهيز مش مظبوطة.",

  // orders
  "Invalid order id.": "رقم الطلب اللي في الرابط مش مظبوط.",
  "Order not found.": "الطلب ده مش موجود.",
  "Invalid order item id.": "رقم صنف الطلب مش مظبوط.",
  "Order item not found.": "صنف الطلب ده مش موجود.",
  "Order line not found.": "سطر الطلب ده مش موجود.",
  "Invalid fulfillment transition.": "انتقال حالة الطلب ده مش مسموح من الحالة الحالية.",
  "Invalid proposal.": "بيانات اقتراح البديل مش مظبوطة.",
  "Invalid replacement id.": "رقم البديل مش مظبوط.",
  "Replacement not found.": "البديل ده مش موجود.",
  "Invalid target.": "بيانات الهدف مش مظبوطة.",
  "Invalid target id.": "رقم الهدف مش مظبوط.",
  "Target not found.": "الهدف ده مش موجود.",
  "Invalid customer.": "بيانات العميل مش مظبوطة. راجع الاسم والتليفون.",
  "Invalid customer id.": "رقم العميل اللي في الرابط مش مظبوط.",
  "Customer not found.": "العميل ده مش موجود.",
  "Invalid address.": "بيانات العنوان مش مظبوطة. راجع المنطقة والعنوان.",
  "Invalid address id.": "رقم العنوان اللي في الرابط مش مظبوط.",
  "Address not found.": "العنوان ده مش موجود.",

  // promotions & coupons
  "Invalid promotion.": "بيانات العرض مش مظبوطة. راجع نوع الخصم والقيمة.",
  "Invalid promotion id.": "رقم العرض اللي في الرابط مش مظبوط.",
  "Promotion not found.": "العرض ده مش موجود.",
  "Invalid rules.": "قواعد العرض مش مظبوطة. راجع الحد الأدنى للطلب.",
  "Invalid buy-get rules.": "قاعدة «اشترِ واحصل» مش مظبوطة. راجع الكميات والنسبة.",
  "Promotion values are immutable once referenced by orders.":
    "مش ينفع تغيّر قيمة العرض ده لأن طلبات اتعملت عليه. اعمل عرض جديد بالقيمة الجديدة.",
  "Invalid coupon.": "بيانات كود الخصم مش مظبوطة. لازم يكون فيه كود فاضي من المسافات.",
  "Invalid coupon id.": "رقم كود الخصم اللي في الرابط مش مظبوط.",
  "Coupon not found.": "كود الخصم ده مش موجود.",
  "Invalid coupon code.": "كود الخصم مش مظبوط. لازم يكون من غير مسافات.",

  // users, roles, permissions
  "Invalid user.": "بيانات المستخدم مش مظبوطة. راجع الاسم والبريد.",
  "Invalid user id.": "رقم المستخدم اللي في الرابط مش مظبوط.",
  "User not found.": "المستخدم ده مش موجود.",
  "Invalid role.": "بيانات الدور مش مظبوطة. لازم يكون فيه اسم مختلف عن الموجود.",
  "Invalid role id.": "رقم الدور اللي في الرابط مش مظبوط.",
  "Role not found.": "الدور ده مش موجود.",
  "Invalid grant.": "بيانات منح الصلاحية مش مظبوطة.",
  "Invalid grant id.": "رقم منح الصلاحية اللي في الرابط مش مظبوط.",
  "Grant not found.": "منح الصلاحية ده مش موجود.",
  "Invalid role assignment.": "بيانات ربط الدور بالمستخدم مش مظبوطة.",
  "Invalid role assignment id.": "رقم ربط الدور بالمستخدم مش مظبوط.",
  "Role assignment not found.": "ربط الدور بالمستخدم ده مش موجود.",
  "Invalid permission id.": "رقم الصلاحية اللي في الرابط مش مظبوط.",
  "Permission not found.": "الصلاحية دي مش موجودة.",

  // settings, delivery, audit
  "Invalid setting.": "بيانات الإعداد مش مظبوطة.",
  "Invalid setting key.": "اسم الإعداد مش مظبوط.",
  "Setting not found.": "الإعداد ده مش موجود.",
  "Invalid delivery zone.": "بيانات منطقة التوصيل مش مظبوطة. لازم يكون فيها اسم وتكلفة.",
  "Invalid delivery zone id.": "رقم منطقة التوصيل اللي في الرابط مش مظبوط.",
  "Delivery zone not found.": "منطقة التوصيل دي مش موجودة.",
  "Invalid audit id.": "رقم السجل اللي في الرابط مش مظبوط.",
  "Audit record not found.": "سجل التغيير ده مش موجود.",

  // catalogue details
  "Product does not exist.": "المنتج ده مش موجود.",
  "Variant does not exist.": "الشكل البيعي ده مش موجود.",
  "Variant has no sale unit.": "الشكل البيعي ده مالهوش وحدة بيع. ظبّط الوحدة الأول.",
  "Variant is not sellable.": "الشكل البيعي ده مش قابل للبيع في الحالة الحالية.",
  "Variant size must be positive.": "مقاس الشكل البيعي لازم يكون أكبر من صفر.",
  "Category does not exist.": "التصنيف ده مش موجود.",
  "Brand does not exist.": "العلامة التجارية دي مش موجودة.",
  "Invalid code.": "الكود مش مظبوط.",
  "Invalid slug.": "المعرّف في الرابط مش مظبوط.",
  "Slug is empty after normalization.": "المعرّف في الرابط فاضي. اكتب اسمًا أو معرّفًا صحيح.",
  "Invalid image URL.": "رابط الصورة مش مظبوط.",
  "Invalid percent.": "النسبة مش مظبوطة. لازم تكون رقم من صفر لمية.",
  "Invalid quantity.": "الكمية مش مظبوطة.",
  "Invalid amount.": "المبلغ مش مظبوط.",
  "Product weight shape violates the catalog weight rule.":
    "وزن المنتج مش مطابق لقاعدة الكتالوج. المنتج اللي بيتsold بالوزن لازم يكون ليه خطوة بيع بالوزن.",
  "Weight product is missing its sale step.": "المنتج اللي بيتsold بالوزن مالهوش خطوة بيع بالوزن.",
  "Compare-at price must be at least the selling price.":
    "السعر قبل الخصم لازم يكون أكبر من سعر البيع أو مساويه.",
  "New price exceeds the compare-at price.": "السعر الجديد أكبر من سعر البيع، وده مش مسموح.",
  "Inventory already exists for this variant.": "فيه رصيد مخزون مسجل للشكل البيعي ده بالفعل.",
  "Inventory cannot be created for a variant that is not sellable.":
    "مش ينفع تفتح رصيد مخزون لشكل بيعي مش قابل للبيع.",
  "Free variant does not exist or is not live.": "الشكل البيعي المجاني مش موجود أو مش معروض.",
  "At least one field is required.": "لازم تعدّل حقل واحد على الأقل.",
  "Invalid role name.": "اسم الدور مش مظبوط.",
  "Invalid email.": "البريد الإلكتروني مش مظبوط.",
  "Invalid phone.": "رقم التليفون مش مظبوط.",
  "Invalid phone number.": "رقم التليفون مش مظبوط.",
  "Invalid customer identity.": "بيانات تعريف العميل مش مظبوطة.",
  "Invalid delivery fee.": "تكلفة التوصيل مش مظبوطة.",
  "Delivery fee misconfigured.": "إعدادات تكلفة التوصيل فيها غلطة.",
  "Delivery fee must be a non-negative amount with at most two decimals.":
    "تكلفة التوصيل لازم تكون مبلغ صفر أو أكبر، وبحد أقصى رقمين عشريين.",
  "Delivery fee changed since the order was reviewed.":
    "تكلفة التوصيل اتغيّرت من وقت ما الطلب اتراجع. راجع الطلب تاني.",
  "Delivery zone name is empty after normalization.": "اسم منطقة التوصيل فاضي. اكتب اسم المنطقة.",
  "A delivery zone with this name already exists.": "فيه منطقة توصيل بنفس الاسم. اختار اسم تاني.",
  "Setting value does not match its type.": "قيمة الإعداد مش مناسبة لنوعه.",
  "Invalid search request.": "البحث مش مظبوط. جرّب كلمة تانية.",
  "Invalid reprice request.": "طلب إعادة التسعير مش مظبوط.",
  "Invalid quantity value.": "الكمية مش مظبوطة.",

  // stock
  "Insufficient availability.": "الكمية المتاحة مش كفاية.",
  "Insufficient availability for the substitute.": "الكمية المتاحة من البديل مش كفاية.",
  "Insufficient stock for this adjustment.": "الكمية المتاحة مش كفاية للتسوية دي.",
  "Insufficient stock for this operation.": "الكمية المتاحة مش كفاية للخطوة دي.",
  "Insufficient stock to commit.": "الكمية المتاحة مش كفاية لتثبيت الخصم من المخزن.",
  "Insufficient reserved quantity to release.": "الكمية المحجوزة مش كفاية للتحرير.",
  "Piece quantity must be whole packs.": "الكمية لازم تكون عدد صحيح من العبوات.",
  "Picked quantity must be positive.": "كمية التجهيز لازم تكون أكبر من صفر.",
  "Actual quantity exceeds the fulfillment envelope.":
    "الكمية الفعلية أكبر من الكمية اللي اتحجزت للطلب. راجع الكمية المتاحة.",
  "Reservation invariant broken.": "حجز الكمية في حالة غير سليمة. راجع الصفحة تاني.",
  "Allocation key without item.": "توزيع الكمية من غير صنف محدد.",
  "Free line key without item.": "سطر بدون صنف.",
  "Free variant does not exist.": "الشكل البيعي ده مش موجود.",

  // promotions & coupons
  "Promotion does not exist.": "العرض ده مش موجود.",
  "Promotion target does not exist or is not live.": "الهدف المحدد للعرض مش موجود أو مش معروض.",
  "Promotion target already exists.": "الهدف ده مضاف على العرض بالفعل.",
  "Promotion value shape violates its type.": "قيمة العرض مش مناسبة لنوعه.",
  "Promotion window end must be after start.": "نهاية مدة العرض لازم تكون بعد بدايتها.",
  "Promotion rules are immutable once referenced by orders.":
    "مش ينفع تغيّر قواعد العرض ده لأن طلبات اتعملت عليه.",
  "Promotion targets are immutable once referenced by orders.":
    "مش ينفع تغيّر استهداف العرض ده لأن طلبات اتعملت عليه.",
  "Promotion is referenced by order history.":
    "العرض ده مربوط بطلبات اتعملت، فمش ينفع تشيله. اعرضه كمسودة بدل كده.",
  "Promotions activate with targets configured.": "العرض اتفعّل. راجع الاستهداف والتواريخ.",
  "LINE promotions activate with at least one target.":
    "العرض على مستوى السطر محتاج هدف واحد على الأقل قبل ما يتفعّل.",
  "Promotion line key without item.": "سطر عرض بدون صنف.",
  "Coupon code already exists.": "كود الخصم ده مسجّل بالفعل.",
  "Coupon is not currently valid.": "كود الخصم ده مش صالح في الوقت دلوقتي.",
  "Coupon minimum order amount not reached.": "الطلب أقل من الحد الأدنى المطلوب لكود الخصم.",
  "Coupon usage limit reached.": "كود الخصم وصل لحد الاستخدام المسموح.",
  "Coupon per-customer limit reached.": "العميل ده وصل لحد استخدام كود الخصم المسموح.",
  "Coupon promotion limit reached.": "العرض المرتبط بكود الخصم وصل لحد الاستخدام المسموح.",
  "Coupon promotion type is not supported.": "نوع العرض المرتبط بكود الخصم مش مدعوم.",
  "Coupon grants no discount.": "كود الخصم ده مش بيخّصم حاجة.",
  "Coupon has no eligible lines.": "مفيش سطر في الطلب qualifies لكود الخصم ده.",
  "Coupon requires a customer account.": "كود الخصم ده محتاج عميل مسجّل دخول.",
  "Coupon is referenced by order history.":
    "كود الخصم ده مربوط بطلبات اتعملت، فمش ينفع تشيله. اعطّله بدل كده.",
  "Invalid cancel request.": "طلب الإلغاء مش مظبوط.",
  "Invalid decision.": "القرار مش مظبوط.",
  "Invalid login request.": "بيانات الدخول مش مظبوطة.",
  "Invalid password change request.": "طلب تغيير كلمة السر مش مظبوط.",
  "Password does not meet policy.":
    "كلمة السر مش مطابقة للشروط: 12 حرف على الأقل، وفيها رقم ورمز وحرف كبير وحرف صغير.",
  "Email is already in use.": "البريد الإلكتروني ده مسجّل على حساب تاني.",
  "User email or phone already exists.": "البريد أو رقم التليفون ده مسجّل على حساب تاني.",
  "An account with this phone already exists.": "فيه حساب تاني بنفس رقم التليفون.",
  "Customer is already registered.": "العميل ده مسجّل بالفعل.",
  "Customer is not active.": "حساب العميل ده مش مفعّل.",
  "Inactive customers cannot be registered.": "مش ينفع تسجّل عميل حسابه مش مفعّل.",
  "Customer required.": "الخطوة دي محتاجة عميل.",
  "Referenced customer does not exist.": "العميل المحدد مش موجود.",
  "Email or phone already exists.": "البريد أو رقم التليفون ده مسجّل بالفعل.",
  "Customer required for this action.": "الخطوة دي محتاجة عميل.",

  // roles, permissions, grants
  "Role name already exists.": "فيه دور بنفس الاسم. اختار اسم تاني.",
  "Role is not active.": "الدور ده مش مفعّل.",
  "Role is still granted and cannot be deleted.":
    "الدور ده متسلّم لحد تاني، فمش ينفع تشيله. شيله من المستخدمين الأول.",
  "Role already assigned to user.": "الدور ده متسلّم للمستخدم ده بالفعل.",
  "Permission already granted to role.": "الصلاحية دي ممنوحة للدور بالفعل.",
  "Cannot assign a role with permissions outside your own effective set.":
    "مش ينفع تسند دور فيه صلاحيات أعلى من صلاحياتك. اختار دور في حدود صلاحياتك.",
  "Cannot grant a permission outside your own effective set.":
    "مش ينفع تمنح صلاحية أعلى من صلاحياتك.",
  "Referenced role or permission does not exist.": "الدور أو الصلاحية المحددة مش موجودة.",
  "Referenced user or role does not exist.": "المستخدم أو الدور المحدد مش موجود.",
  "Administrators cannot deactivate their own account.":
    "مش ينفع تعطّل حسابك انت. اختار حساب تاني.",
  "A default address already exists for this customer.": "العميل ده عنده عنوان رئيسي بالفعل.",
  "Delivery zone name already exists.": "فيه منطقة توصيل بنفس الاسم.",

  // orders & fulfillment
  "Order cannot be cancelled in its current state.":
    "الطلب مش قابل للإلغاء في الحالة دي.",
  "Order has picked lines and cannot be cancelled here.":
    "فيه أصناف اتجهّزت من المخزن، فالطلب مش قابل للإلغاء من هنا.",
  "Order has undecided replacements.": "فيه اقتراحات بدائل لسه متاخدتش قرار.",
  "Order has unresolved lines.": "فيه أصناف في الطلب لسه محتاجة قرار.",
  "Order line is already resolved.": "صنف الطلب ده اتقفل بالفعل.",
  "Original line cannot be replaced now.": "الصنف الأصلي مش قابل لاقتراح بديل في الوقت دلوقتي.",
  "Line cannot take a replacement proposal.": "الصنف ده مش قابل لاقتراح بديل.",
  "A proposal is already open for this line.": "فيه اقتراح بديل مفتوح بالفعل على الصنف ده.",
  "Only the customer can approve a replacement.": "العميل هو الوحيد اللي يقدر يوافق على البديل.",
  "Pre-consent does not cover this replacement.":
    "العميل ماوافقش على استبدال الصنف ده. ارجعله وموافقته.",
  "Substitute is no longer sellable.": "البديل ده مش قابل للبيع في الوقت دلوقتي.",
  "Substitute variant is not sellable.": "البديل ده مش قابل للبيع.",
  "Substitute variant not found.": "البديل ده مش موجود.",
  "Picked lines belong to fulfillment.": "الأصناف دي اتجهّزت فعلاً، فمش هتتغير تاني.",
  "Replacement is no longer open.": "اقتراح البديل ده اتقفل.",
  "Invalid guest token.": "رابط الوصول مش صالح. اطلب من العميل رقم الطلب.",
  "A valid guest token is required.": "رابط الوصول مش صالح.",
  "Guest checkout session is only available for guest carts.": "الجلسة دي لسه مش مربوطة بسلة.",
  "Guest checkout requires both guestAddress and guestContact.":
    "لازم تكتب العنوان وبيانات التواصل مع بعض.",
  "Guest checkout requires guestAddress and guestContact.":
    "لازم تكتب العنوان وبيانات التواصل مع بعض.",
  "Authenticated checkout requires addressId.": "اختار عنوان التوصيل من اللي متسجل.",
  "Guest cart is no longer available for merge.": "سلّة الزائر انتهت صلاحيتها.",
  "Guest cart not found.": "سلّة الزائر مش موجودة.",
  "Active cart not found.": "سلّة الشراء مش موجودة.",
  "Cart is empty.": "سلّة الشراء فاضية.",
  "Cart is no longer available for ordering.": "السلّة دي مش صالحة للطلب.",
  "Cart contains an unsellable variant.": "فيه صنف في السلّة مش قابل للبيع.",
  "Cart line not found.": "سطر في السلّة مش موجود.",
  "Cart line unit no longer matches the variant.": "وحدة البيع في السلّة بقت مختلفة عن المنتج.",
  "Invalid cart item.": "صنف في السلّة مش مظبوط.",
  "Invalid merge request.": "طلب دمج السلّات مش مظبوط.",
  "Invalid order request.": "بيانات الطلب مش مظبوطة.",
  "Invalid estimate request.": "طلب تقدير التوصيل مش مظبوط.",
  "Prices changed since items were added to the cart.":
    "الأسعار اتغيّرت من وقت ما حطيت الأصناف في السلّة. راجع الطلب تاني.",
  "Conflicting idempotency keys.": "في طلبين مختلفين بنفس المفتاح. جرّب تاني.",
  "Conflicting request under the same idempotency key.": "في طلب تاني بنفس المفتاح. جرّب تاني.",
  "Idempotency key is required.": "مفتاح الطلب مطلوب.",
  "Idempotency key was already used with different terms.":
    "المفتاح ده اتستخدم قبل كده ببيانات مختلفة.",
  "Invalid idempotency key.": "مفتاح الطلب مش مظبوط.",
  "Registration rate-limit phone secret is not configured.":
    "إعدادات حماية التسجيل ناقصة. كلّم مالك المتجر.",
  "Registration rate-limit phone secret is too short.":
    "إعدادات حماية التسجيل ناقصة. كلّم مالك المتجر.",
  "Invalid guest checkout context.": "سياق سلة الزائر مش مظبوط.",
  "Weight quantity violates the sale step.":
    "الكمية مش مضاعفة خطوة البيع بالوزن. عدّل الكمية بحيث تبقى بالضبط.",
  "Width and height must be provided together.":
    "لو هتحدد العرض والارتفاع، لازم تحدد الاتنين مع بعض.",
};

/** What to say when the error code is known but the message is not. */
const CODE_FALLBACKS: Record<string, string> = {
  VALIDATION: "البيانات اللي اتبعتت مش مظبوطة. راجع الحقول وحاول تاني.",
  NOT_FOUND: "الحاجة اللي بتدور عليها مش موجودة.",
  FORBIDDEN: "حسابك مش مسموح له بالخطوة دي.",
  UNAUTHENTICATED: "محتاج تسجّل دخول الأول.",
  CONFLICT: "فيه حد تاني عدّل نفس الحاجة قبلك. افتح الصفحة تاني وشوف آخر حالة.",
  BUSINESS_RULE: "الخطوة دي مش مسموحة في الحالة الحالية.",
  RATE_LIMITED: "عملت طلبات كتير في وقت قصير. استنى شوية وحاول تاني.",
  GONE: "الرابط ده انتهت صلاحيته.",
  INTERNAL: "حصلت مشكلة في الخادم. حاول تاني.",
};

/**
 * The Arabic sentence the admin UI shows for a failed operation.
 * `fallback` is used when the failure is not an API error at all.
 */
export function adminErrorMessage(error: unknown, fallback: string): string {
  const appError = error as Partial<AppError> | null;
  if (!appError || typeof appError !== "object" || typeof appError.code !== "string") {
    return fallback;
  }
  const raw = typeof appError.message === "string" ? appError.message : "";
  const translated = MESSAGE_TRANSLATIONS[raw];
  if (translated) return translated;

  const codeFallback = CODE_FALLBACKS[appError.code];
  if (codeFallback) return codeFallback;

  // An unrecognised server message must never reach the screen as English.
  return fallback;
}
