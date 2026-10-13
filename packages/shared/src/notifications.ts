/**
 * Notification catalog. Every event the platform can notify about, with default
 * bilingual text. Admins can edit text, switch push/inbox per event, or disable an
 * event entirely (stored in NotificationTemplate). Variables use {{name}}.
 */

export const NotificationCategory = {
  TOURNAMENTS: 'TOURNAMENTS',
  DUELS: 'DUELS',
  RESULTS: 'RESULTS',
  PAYMENTS: 'PAYMENTS',
  LEARNING: 'LEARNING',
  ACCOUNT: 'ACCOUNT',
  SUPPORT: 'SUPPORT',
  PROMOTIONS: 'PROMOTIONS',
} as const;
export type NotificationCategory = (typeof NotificationCategory)[keyof typeof NotificationCategory];

export const CATEGORY_INFO: Record<NotificationCategory, { labelEn: string; labelHi: string; descriptionEn: string; descriptionHi: string; mutable: boolean }> = {
  TOURNAMENTS: { labelEn: 'Tournaments', labelHi: 'टूर्नामेंट', descriptionEn: 'Registration, reminders, live alerts', descriptionHi: 'पंजीकरण, रिमाइंडर, लाइव अलर्ट', mutable: true },
  DUELS: { labelEn: '1v1 Duels', labelHi: '1v1 मुकाबले', descriptionEn: 'Challenges, rematches and duel results', descriptionHi: 'चुनौतियाँ, रीमैच और मुकाबले के परिणाम', mutable: true },
  RESULTS: { labelEn: 'Results & rewards', labelHi: 'परिणाम और पुरस्कार', descriptionEn: 'Ranks, corrections, rewards and payouts', descriptionHi: 'रैंक, सुधार, पुरस्कार और भुगतान', mutable: true },
  PAYMENTS: { labelEn: 'Payments', labelHi: 'भुगतान', descriptionEn: 'Debits, refunds and receipts', descriptionHi: 'भुगतान, रिफंड और रसीदें', mutable: false },
  LEARNING: { labelEn: 'Learning', labelHi: 'पढ़ाई', descriptionEn: 'Streaks, missions and test results', descriptionHi: 'स्ट्रीक, मिशन और टेस्ट परिणाम', mutable: true },
  ACCOUNT: { labelEn: 'Account & security', labelHi: 'खाता और सुरक्षा', descriptionEn: 'Important account updates', descriptionHi: 'खाते से जुड़े ज़रूरी अपडेट', mutable: false },
  SUPPORT: { labelEn: 'Support', labelHi: 'सहायता', descriptionEn: 'Replies to your requests', descriptionHi: 'आपके अनुरोधों के जवाब', mutable: true },
  PROMOTIONS: { labelEn: 'Offers & new events', labelHi: 'ऑफ़र और नए इवेंट', descriptionEn: 'New tournaments for your exams, seats filling fast, offers', descriptionHi: 'आपकी परीक्षाओं के नए टूर्नामेंट, सीटें तेज़ी से भर रही हैं, ऑफ़र', mutable: true },
};

export interface NotificationEventDef {
  category: NotificationCategory;
  /** Short description for admins. */
  descriptionEn: string;
  /** Variables the template may use. */
  vars: string[];
  titleEn: string;
  titleHi: string;
  bodyEn: string;
  bodyHi: string;
  push: boolean;
  inbox: boolean;
}

const e = (d: NotificationEventDef) => d;

export const NOTIFICATION_EVENTS = {
  PROCTOR_AUTO_WARNING: e({ category: 'TOURNAMENTS', descriptionEn: 'Automatic proctoring warning (flag rule with auto-warn on)', vars: ['test', 'reason'], titleEn: '⚠️ Proctoring warning · {{test}}', titleHi: '⚠️ निगरानी चेतावनी · {{test}}', bodyEn: '{{reason}} This has been recorded for review.', bodyHi: '{{reason}} यह समीक्षा के लिए दर्ज किया गया है।', push: true, inbox: true }),
  PROCTOR_TERMINATED: e({ category: 'TOURNAMENTS', descriptionEn: 'Proctored attempt ended early (by a proctor or the auto rule)', vars: ['test', 'reason'], titleEn: 'Your test was ended', titleHi: 'आपका टेस्ट समाप्त किया गया', bodyEn: '{{test}} was submitted early: {{reason}}. You can appeal from Help & support.', bodyHi: '{{test}} जल्दी जमा किया गया: {{reason}}। आप सहायता से अपील कर सकते हैं।', push: true, inbox: true }),
  PROCTOR_WARNING: e({ category: 'TOURNAMENTS', descriptionEn: 'Admin warning sent during an active proctored attempt', vars: ['tournament', 'reason'], titleEn: 'Proctor message · {{tournament}}', titleHi: 'परीक्षा संदेश · {{tournament}}', bodyEn: 'An exam administrator sent you a message: {{reason}}', bodyHi: 'परीक्षा व्यवस्थापक ने आपको संदेश भेजा: {{reason}}', push: true, inbox: true }),
  // ---------------- Tournaments
  TOURNAMENT_REGISTERED: e({ category: 'TOURNAMENTS', descriptionEn: 'Free registration confirmed', vars: ['tournament', 'startsAt'], titleEn: "You're in! 🎯", titleHi: 'आप शामिल हैं! 🎯', bodyEn: 'Registered for {{tournament}}. It starts {{startsAt}}.', bodyHi: '{{tournament}} के लिए पंजीकृत। यह {{startsAt}} शुरू होगा।', push: true, inbox: true }),
  TOURNAMENT_WAITLISTED: e({ category: 'TOURNAMENTS', descriptionEn: 'Added to waitlist (tournament full)', vars: ['tournament'], titleEn: "You're on the waitlist", titleHi: 'आप प्रतीक्षा सूची में हैं', bodyEn: "{{tournament}} is full. We'll confirm you if a seat opens.", bodyHi: '{{tournament}} भर गया है। सीट खाली होने पर हम पुष्टि करेंगे।', push: true, inbox: true }),
  TOURNAMENT_WAITLIST_PROMOTED: e({ category: 'TOURNAMENTS', descriptionEn: 'Moved from waitlist to confirmed', vars: ['tournament'], titleEn: 'A seat opened up! 🎉', titleHi: 'एक सीट खाली हुई! 🎉', bodyEn: "You're now confirmed for {{tournament}}.", bodyHi: 'अब {{tournament}} के लिए आपकी पुष्टि हो गई है।', push: true, inbox: true }),
  TOURNAMENT_REGISTRATION_CANCELLED: e({ category: 'TOURNAMENTS', descriptionEn: 'Student cancelled their registration', vars: ['tournament'], titleEn: 'Registration cancelled', titleHi: 'पंजीकरण रद्द', bodyEn: 'Your registration for {{tournament}} was cancelled.', bodyHi: '{{tournament}} के लिए आपका पंजीकरण रद्द कर दिया गया।', push: false, inbox: true }),
  TOURNAMENT_STARTING_SOON: e({ category: 'TOURNAMENTS', descriptionEn: 'Reminder before the test window opens (timings in Settings)', vars: ['tournament', 'minutes'], titleEn: '⏰ Starts in {{minutes}}', titleHi: '⏰ {{minutes}} में शुरू', bodyEn: '{{tournament}} starts in {{minutes}}. Be ready with a stable connection.', bodyHi: '{{tournament}} {{minutes}} में शुरू होगा। स्थिर इंटरनेट के साथ तैयार रहें।', push: true, inbox: true }),
  TOURNAMENT_LIVE: e({ category: 'TOURNAMENTS', descriptionEn: 'Test window opened', vars: ['tournament'], titleEn: '🔴 {{tournament}} is live!', titleHi: '🔴 {{tournament}} लाइव है!', bodyEn: 'Start your test before the window closes.', bodyHi: 'विंडो बंद होने से पहले अपना टेस्ट शुरू करें।', push: true, inbox: true }),
  TOURNAMENT_ENDING_SOON: e({ category: 'TOURNAMENTS', descriptionEn: "Window closing and you haven't submitted", vars: ['tournament', 'minutes'], titleEn: '⌛ {{minutes}} left to take {{tournament}}', titleHi: '⌛ {{tournament}} देने के लिए {{minutes}} बाकी', bodyEn: "The test window closes soon and you haven't submitted yet.", bodyHi: 'टेस्ट विंडो जल्द बंद होगी और आपने अभी जमा नहीं किया है।', push: true, inbox: true }),
  TOURNAMENT_CANCELLED: e({ category: 'TOURNAMENTS', descriptionEn: 'Tournament cancelled (refunds automatic)', vars: ['tournament', 'reason'], titleEn: '{{tournament}} was cancelled', titleHi: '{{tournament}} रद्द कर दिया गया', bodyEn: '{{reason}}. Any entry fee is refunded automatically.', bodyHi: '{{reason}}। कोई भी प्रवेश शुल्क अपने आप लौटा दिया जाएगा।', push: true, inbox: true }),
  TOURNAMENT_RULES_CHANGED: e({ category: 'TOURNAMENTS', descriptionEn: 'Published rule change', vars: ['tournament', 'summary'], titleEn: 'Rule update: {{tournament}}', titleHi: 'नियम अपडेट: {{tournament}}', bodyEn: '{{summary}}', bodyHi: '{{summary}}', push: true, inbox: true }),
  ATTEMPT_AUTO_SUBMITTED: e({ category: 'TOURNAMENTS', descriptionEn: 'Test submitted automatically (time up / window closed)', vars: ['test'], titleEn: 'Your test was submitted', titleHi: 'आपका टेस्ट जमा हो गया', bodyEn: "Time ran out on {{test}}, so we submitted your saved answers.", bodyHi: '{{test}} का समय समाप्त हो गया, इसलिए आपके सेव उत्तर जमा कर दिए गए।', push: true, inbox: true }),

  // ---------------- Promotions / "join fast"
  NEW_TOURNAMENT: e({ category: 'PROMOTIONS', descriptionEn: 'New tournament published for an exam the student follows', vars: ['tournament', 'exam'], titleEn: 'New {{exam}} Test War 🏆', titleHi: 'नया {{exam}} टेस्ट वॉर 🏆', bodyEn: '{{tournament}} is open for registration. Grab your seat!', bodyHi: '{{tournament}} में पंजीकरण खुला है। अपनी सीट पक्की करें!', push: true, inbox: true }),
  REGISTRATION_CLOSING_SOON: e({ category: 'PROMOTIONS', descriptionEn: "Registration closing soon (to eligible students who haven't joined)", vars: ['tournament', 'minutes'], titleEn: 'Last call: {{tournament}}', titleHi: 'आखिरी मौका: {{tournament}}', bodyEn: 'Registration closes in {{minutes}}. Join now!', bodyHi: 'पंजीकरण {{minutes}} में बंद होगा। अभी जुड़ें!', push: true, inbox: true }),
  SEATS_FILLING_FAST: e({ category: 'PROMOTIONS', descriptionEn: 'Seats filling fast (threshold in Settings)', vars: ['tournament', 'percent', 'seatsLeft'], titleEn: '🔥 {{percent}}% full — join fast!', titleHi: '🔥 {{percent}}% भर गया — जल्दी जुड़ें!', bodyEn: 'Only {{seatsLeft}} seats left in {{tournament}}.', bodyHi: '{{tournament}} में केवल {{seatsLeft}} सीटें बाकी हैं।', push: true, inbox: true }),

  // ---------------- Results & rewards
  RESULTS_PROVISIONAL: e({ category: 'RESULTS', descriptionEn: 'Provisional results published', vars: ['tournament'], titleEn: 'Provisional results are out', titleHi: 'अनंतिम परिणाम जारी', bodyEn: 'See your rank in {{tournament}}. Results become official after review.', bodyHi: '{{tournament}} में अपनी रैंक देखें। समीक्षा के बाद परिणाम आधिकारिक होंगे।', push: true, inbox: true }),
  RESULTS_FINAL: e({ category: 'RESULTS', descriptionEn: 'Official results published', vars: ['tournament'], titleEn: 'Official results published', titleHi: 'आधिकारिक परिणाम प्रकाशित', bodyEn: '{{tournament}} results are now final.', bodyHi: '{{tournament}} के परिणाम अब अंतिम हैं।', push: true, inbox: true }),
  RESULT_DISQUALIFIED: e({ category: 'RESULTS', descriptionEn: 'Entry disqualified during review', vars: ['tournament', 'reason'], titleEn: 'Result under review', titleHi: 'परिणाम समीक्षा में', bodyEn: 'Your entry in {{tournament}} was disqualified: {{reason}}. You can appeal from Help & support.', bodyHi: '{{tournament}} में आपकी प्रविष्टि अयोग्य घोषित की गई: {{reason}}। आप सहायता से अपील कर सकते हैं।', push: true, inbox: true }),
  RESULT_REINSTATED: e({ category: 'RESULTS', descriptionEn: 'Disqualification reversed', vars: ['tournament'], titleEn: 'Entry reinstated', titleHi: 'प्रविष्टि बहाल', bodyEn: 'Your entry in {{tournament}} has been reinstated.', bodyHi: '{{tournament}} में आपकी प्रविष्टि बहाल कर दी गई है।', push: true, inbox: true }),
  RESULT_SCORE_ADJUSTED: e({ category: 'RESULTS', descriptionEn: 'Score corrected during review', vars: ['tournament', 'amount', 'reason'], titleEn: 'Score corrected', titleHi: 'स्कोर में सुधार', bodyEn: 'Your score in {{tournament}} was adjusted by {{amount}}: {{reason}}.', bodyHi: '{{tournament}} में आपका स्कोर {{amount}} से बदला गया: {{reason}}।', push: true, inbox: true }),
  REWARD_APPROVED: e({ category: 'RESULTS', descriptionEn: 'Reward approved', vars: ['tournament', 'reward'], titleEn: 'Reward approved 🎉', titleHi: 'पुरस्कार स्वीकृत 🎉', bodyEn: 'Your reward for {{tournament}} ({{reward}}) is approved.', bodyHi: '{{tournament}} के लिए आपका पुरस्कार ({{reward}}) स्वीकृत हुआ।', push: true, inbox: true }),
  REWARD_PAID: e({ category: 'RESULTS', descriptionEn: 'Reward paid out / delivered (payout credited)', vars: ['tournament', 'reward', 'reference'], titleEn: 'Reward sent 💸', titleHi: 'पुरस्कार भेजा गया 💸', bodyEn: '{{reward}} for {{tournament}} has been paid/delivered. Reference: {{reference}}.', bodyHi: '{{tournament}} के लिए {{reward}} भेज दिया गया। संदर्भ: {{reference}}।', push: true, inbox: true }),
  REWARD_WITHHELD: e({ category: 'RESULTS', descriptionEn: 'Reward withheld', vars: ['tournament', 'reason'], titleEn: 'Reward on hold', titleHi: 'पुरस्कार रोका गया', bodyEn: 'Your reward for {{tournament}} is on hold: {{reason}}. Contact support for help.', bodyHi: '{{tournament}} के लिए आपका पुरस्कार रोका गया: {{reason}}। मदद के लिए सहायता से संपर्क करें।', push: true, inbox: true }),

  // ---------------- Payments (debits & credits)
  PAYMENT_SUCCESS: e({ category: 'PAYMENTS', descriptionEn: 'Payment debited successfully', vars: ['amount', 'item', 'receipt'], titleEn: 'Payment successful · {{amount}}', titleHi: 'भुगतान सफल · {{amount}}', bodyEn: '{{amount}} paid for {{item}}. Receipt {{receipt}}.', bodyHi: '{{item}} के लिए {{amount}} का भुगतान हुआ। रसीद {{receipt}}।', push: true, inbox: true }),
  PAYMENT_FAILED: e({ category: 'PAYMENTS', descriptionEn: 'Payment failed', vars: ['amount', 'item'], titleEn: 'Payment failed', titleHi: 'भुगतान असफल', bodyEn: 'Your payment of {{amount}} for {{item}} failed. You were not charged.', bodyHi: '{{item}} के लिए {{amount}} का भुगतान असफल रहा। आपसे राशि नहीं ली गई।', push: true, inbox: true }),
  CHECKOUT_EXPIRED: e({ category: 'PAYMENTS', descriptionEn: 'Unpaid checkout expired (seat released)', vars: ['item'], titleEn: 'Checkout expired', titleHi: 'भुगतान समय समाप्त', bodyEn: 'Your unpaid checkout for {{item}} expired and the seat was released.', bodyHi: '{{item}} का अधूरा भुगतान समाप्त हो गया और सीट छोड़ दी गई।', push: true, inbox: true }),
  REFUND_INITIATED: e({ category: 'PAYMENTS', descriptionEn: 'Refund requested and awaiting approval', vars: ['amount', 'receipt'], titleEn: 'Refund initiated', titleHi: 'रिफंड शुरू', bodyEn: 'A refund of {{amount}} for {{receipt}} is being processed.', bodyHi: '{{receipt}} के लिए {{amount}} का रिफंड प्रक्रिया में है।', push: false, inbox: true }),
  REFUND_PROCESSED: e({ category: 'PAYMENTS', descriptionEn: 'Refund credited to the original payment method', vars: ['amount', 'receipt', 'reason'], titleEn: 'Refund credited · {{amount}}', titleHi: 'रिफंड जमा · {{amount}}', bodyEn: '{{amount}} refunded for {{receipt}} to your original payment method. Reason: {{reason}}', bodyHi: '{{receipt}} के लिए {{amount}} आपके मूल भुगतान माध्यम में लौटाया गया। कारण: {{reason}}', push: true, inbox: true }),
  COINS_TOPPED_UP: e({ category: 'PAYMENTS', descriptionEn: 'Coin top-up credited to the wallet', vars: ['coins', 'amount'], titleEn: '+{{coins}} coins added 🪙', titleHi: '+{{coins}} कॉइन जोड़े गए 🪙', bodyEn: 'Your top-up of {{amount}} was credited to your wallet.', bodyHi: '{{amount}} का टॉप-अप आपके वॉलेट में जमा हो गया।', push: true, inbox: true }),
  COINS_CREDITED: e({ category: 'PAYMENTS', descriptionEn: 'Coins credited (prize, duel win, admin grant)', vars: ['coins', 'reason'], titleEn: '+{{coins}} coins credited 🎉', titleHi: '+{{coins}} कॉइन जमा 🎉', bodyEn: '{{reason}}', bodyHi: '{{reason}}', push: true, inbox: true }),
  COINS_DEBITED: e({ category: 'PAYMENTS', descriptionEn: 'Coins removed by an admin correction or top-up refund', vars: ['coins', 'reason'], titleEn: '{{coins}} coins debited', titleHi: '{{coins}} कॉइन काटे गए', bodyEn: '{{reason}}', bodyHi: '{{reason}}', push: true, inbox: true }),
  REDEMPTION_REQUESTED: e({ category: 'PAYMENTS', descriptionEn: 'Reward redemption requested (coins on hold)', vars: ['reward', 'coins'], titleEn: 'Redemption requested', titleHi: 'रिडेम्पशन अनुरोध भेजा', bodyEn: '{{coins}} coins are on hold for {{reward}}. We will update you soon.', bodyHi: '{{reward}} के लिए {{coins}} कॉइन होल्ड पर हैं। हम जल्द अपडेट देंगे।', push: false, inbox: true }),
  REDEMPTION_APPROVED: e({ category: 'PAYMENTS', descriptionEn: 'Redemption approved, awaiting fulfilment', vars: ['reward'], titleEn: 'Redemption approved ✅', titleHi: 'रिडेम्पशन स्वीकृत ✅', bodyEn: '{{reward}} is approved and being processed.', bodyHi: '{{reward}} स्वीकृत है और प्रक्रिया में है।', push: true, inbox: true }),
  REDEMPTION_FULFILLED: e({ category: 'PAYMENTS', descriptionEn: 'Reward delivered: UPI paid / voucher issued / item shipped', vars: ['reward', 'detail'], titleEn: '{{reward}} is on its way 🎁', titleHi: '{{reward}} भेज दिया गया 🎁', bodyEn: '{{detail}}', bodyHi: '{{detail}}', push: true, inbox: true }),
  REDEMPTION_REJECTED: e({ category: 'PAYMENTS', descriptionEn: 'Redemption rejected or failed (coins returned)', vars: ['reward', 'reason'], titleEn: 'Redemption not completed', titleHi: 'रिडेम्पशन पूरा नहीं हुआ', bodyEn: '{{reward}}: {{reason}}. Your coins were returned.', bodyHi: '{{reward}}: {{reason}}। आपके कॉइन लौटा दिए गए।', push: true, inbox: true }),
  SERIES_UNLOCKED: e({ category: 'PAYMENTS', descriptionEn: 'Test series purchased / unlocked', vars: ['series'], titleEn: '{{series}} unlocked 🔓', titleHi: '{{series}} अनलॉक 🔓', bodyEn: 'Start practising now.', bodyHi: 'अभी अभ्यास शुरू करें।', push: true, inbox: true }),
  ACCESS_GRANTED: e({ category: 'LEARNING', descriptionEn: 'Admin granted free access to a series', vars: ['series', 'days'], titleEn: 'You got free access 🎁', titleHi: 'आपको मुफ़्त एक्सेस मिला 🎁', bodyEn: '{{series}} is unlocked for {{days}} days.', bodyHi: '{{series}} {{days}} दिनों के लिए अनलॉक है।', push: true, inbox: true }),
  ACCESS_EXPIRING: e({ category: 'LEARNING', descriptionEn: 'Series access expiring soon (days in Settings)', vars: ['series', 'days'], titleEn: 'Access ends in {{days}} days', titleHi: 'एक्सेस {{days}} दिनों में समाप्त', bodyEn: 'Your access to {{series}} ends soon. Finish your remaining tests.', bodyHi: '{{series}} का एक्सेस जल्द समाप्त होगा। बाकी टेस्ट पूरे करें।', push: true, inbox: true }),

  // ---------------- Learning
  TEST_RESULT_READY: e({ category: 'LEARNING', descriptionEn: 'Practice test scored', vars: ['test', 'score'], titleEn: 'Result ready: {{score}}', titleHi: 'परिणाम तैयार: {{score}}', bodyEn: 'See solutions for {{test}}.', bodyHi: '{{test}} के समाधान देखें।', push: false, inbox: true }),
  MISSION_COMPLETED: e({ category: 'LEARNING', descriptionEn: 'Daily mission completed', vars: ['mission', 'xp'], titleEn: 'Mission complete! +{{xp}} XP', titleHi: 'मिशन पूरा! +{{xp}} XP', bodyEn: '{{mission}}', bodyHi: '{{mission}}', push: false, inbox: true }),
  STREAK_REMINDER: e({ category: 'LEARNING', descriptionEn: 'Evening reminder to keep the streak (hour in Settings)', vars: ['days'], titleEn: "🔥 Don't lose your {{days}}-day streak", titleHi: '🔥 अपनी {{days}} दिन की स्ट्रीक न टूटने दें', bodyEn: 'Open Testwise and finish today’s mission.', bodyHi: 'Testwise खोलें और आज का मिशन पूरा करें।', push: true, inbox: false }),

  // ---------------- Duels
  DUEL_CHALLENGE_ACCEPTED: e({ category: 'DUELS', descriptionEn: 'Friend joined your challenge code', vars: ['opponent'], titleEn: '{{opponent}} accepted your challenge ⚔️', titleHi: '{{opponent}} ने आपकी चुनौती स्वीकार की ⚔️', bodyEn: 'Open the app to start the duel.', bodyHi: 'मुकाबला शुरू करने के लिए ऐप खोलें।', push: true, inbox: true }),
  DUEL_REMATCH_REQUEST: e({ category: 'DUELS', descriptionEn: 'Opponent asked for a rematch', vars: ['opponent'], titleEn: '{{opponent}} wants a rematch', titleHi: '{{opponent}} रीमैच चाहते हैं', bodyEn: 'Accept within a minute to play again.', bodyHi: 'दोबारा खेलने के लिए एक मिनट में स्वीकार करें।', push: true, inbox: false }),
  DUEL_RESULT: e({ category: 'DUELS', descriptionEn: 'Duel finished', vars: ['opponent', 'outcome', 'rating'], titleEn: 'Duel vs {{opponent}}: {{outcome}}', titleHi: '{{opponent}} से मुकाबला: {{outcome}}', bodyEn: 'Your rating is now {{rating}}.', bodyHi: 'आपकी रेटिंग अब {{rating}} है।', push: false, inbox: true }),
  DUEL_TIER_UP: e({ category: 'DUELS', descriptionEn: 'Reached a new league tier', vars: ['tier'], titleEn: 'Promoted to {{tier}} 🏅', titleHi: '{{tier}} में पदोन्नति 🏅', bodyEn: 'Keep winning duels to climb higher.', bodyHi: 'और ऊपर जाने के लिए मुकाबले जीतते रहें।', push: true, inbox: true }),

  // ---------------- Support & account
  SUPPORT_REPLY: e({ category: 'SUPPORT', descriptionEn: 'Support replied to a ticket', vars: ['subject'], titleEn: 'Support replied', titleHi: 'सहायता टीम ने जवाब दिया', bodyEn: '{{subject}}', bodyHi: '{{subject}}', push: true, inbox: true }),
  ACCOUNT_SUSPENDED: e({ category: 'ACCOUNT', descriptionEn: 'Account suspended', vars: ['reason'], titleEn: 'Account suspended', titleHi: 'खाता निलंबित', bodyEn: 'Your account was suspended: {{reason}}. Contact support to appeal.', bodyHi: 'आपका खाता निलंबित किया गया: {{reason}}। अपील के लिए सहायता से संपर्क करें।', push: true, inbox: true }),
  ACCOUNT_REINSTATED: e({ category: 'ACCOUNT', descriptionEn: 'Account reinstated', vars: [], titleEn: 'Account reinstated', titleHi: 'खाता बहाल', bodyEn: 'Welcome back! Your account is active again.', bodyHi: 'वापसी पर स्वागत है! आपका खाता फिर से सक्रिय है।', push: true, inbox: true }),
  DELETION_REQUESTED: e({ category: 'ACCOUNT', descriptionEn: 'Account deletion request received', vars: [], titleEn: 'Deletion request received', titleHi: 'हटाने का अनुरोध मिला', bodyEn: 'We will process your account deletion and update you in Help & support.', bodyHi: 'हम आपका खाता हटाने का अनुरोध पूरा करेंगे और सहायता में अपडेट देंगे।', push: false, inbox: true }),
} satisfies Record<string, NotificationEventDef>;

export type NotificationEventKey = keyof typeof NOTIFICATION_EVENTS;
export const NOTIFICATION_EVENT_KEYS = Object.keys(NOTIFICATION_EVENTS) as NotificationEventKey[];

/** Template variable: plain text, or a bilingual pair. */
export type TemplateVar = string | number | { en: string; hi?: string | null };

export function renderTemplate(text: string, vars: Record<string, TemplateVar>, lang: 'EN' | 'HI'): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = vars[k];
    if (v == null) return '';
    if (typeof v === 'object') return (lang === 'HI' && v.hi) || v.en;
    return String(v);
  });
}
