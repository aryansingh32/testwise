/* Development seed. Safe to re-run: upserts by unique keys. */
import { PrismaClient, type Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

try {
  process.loadEnvFile('.env');
} catch {
  /* env provided by the platform */
}

const prisma = new PrismaClient();
const day = 86_400_000;
const at = (offsetDays: number, hour = 18) => {
  const d = new Date(Date.now() + offsetDays * day);
  d.setUTCHours(hour - 5, 30, 0, 0); // IST hour
  return d;
};

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@testwise.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026';
  await prisma.adminUser.upsert({
    where: { email },
    create: { email, name: 'Super Admin', role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash(password, 12) },
    update: {},
  });

  const exams = [
    { slug: 'ssc-cgl', nameEn: 'SSC CGL', nameHi: 'एसएससी सीजीएल', category: 'COMPETITIVE', icon: 'briefcase', color: '#F59E0B' },
    { slug: 'banking', nameEn: 'Banking', nameHi: 'बैंकिंग', category: 'COMPETITIVE', icon: 'landmark', color: '#10B981' },
    { slug: 'jee-main', nameEn: 'JEE Main', nameHi: 'जेईई मेन', category: 'COMPETITIVE', icon: 'atom', color: '#3B82F6' },
    { slug: 'neet', nameEn: 'NEET', nameHi: 'नीट', category: 'COMPETITIVE', icon: 'stethoscope', color: '#EF4444' },
    { slug: 'upsc', nameEn: 'UPSC', nameHi: 'यूपीएससी', category: 'COMPETITIVE', icon: 'scale', color: '#8B5CF6' },
    { slug: 'railway', nameEn: 'Railway', nameHi: 'रेलवे', category: 'COMPETITIVE', icon: 'train', color: '#0EA5E9' },
    { slug: 'class-10', nameEn: 'Class 10', nameHi: 'कक्षा 10', category: 'SCHOOL', icon: 'school', color: '#F97316' },
    { slug: 'class-12', nameEn: 'Class 12', nameHi: 'कक्षा 12', category: 'SCHOOL', icon: 'graduation', color: '#14B8A6' },
    { slug: 'olympiad', nameEn: 'Olympiad', nameHi: 'ओलंपियाड', category: 'SCHOOL', icon: 'trophy', color: '#EAB308' },
  ] as const;
  for (const [i, e] of exams.entries()) {
    await prisma.exam.upsert({ where: { slug: e.slug }, create: { ...e, sortOrder: i }, update: { ...e, sortOrder: i } });
  }

  const subjects = [
    { slug: 'quantitative-aptitude', nameEn: 'Quantitative Aptitude', nameHi: 'मात्रात्मक योग्यता', topics: [['percentages', 'Percentages', 'प्रतिशत'], ['time-and-work', 'Time and Work', 'समय और कार्य'], ['ratio', 'Ratio and Proportion', 'अनुपात और समानुपात']] },
    { slug: 'reasoning', nameEn: 'Reasoning', nameHi: 'तर्कशक्ति', topics: [['series', 'Series', 'श्रृंखला'], ['coding-decoding', 'Coding-Decoding', 'कोडिंग-डिकोडिंग']] },
    { slug: 'general-awareness', nameEn: 'General Awareness', nameHi: 'सामान्य जागरूकता', topics: [['polity', 'Polity', 'राजव्यवस्था'], ['geography', 'Geography', 'भूगोल']] },
    { slug: 'physics', nameEn: 'Physics', nameHi: 'भौतिकी', topics: [['kinematics', 'Kinematics', 'शुद्धगतिकी'], ['optics', 'Optics', 'प्रकाशिकी']] },
    { slug: 'mathematics', nameEn: 'Mathematics', nameHi: 'गणित', topics: [['algebra', 'Algebra', 'बीजगणित'], ['geometry', 'Geometry', 'ज्यामिति']] },
    { slug: 'english', nameEn: 'English', nameHi: 'अंग्रेज़ी', topics: [['grammar', 'Grammar', 'व्याकरण'], ['vocabulary', 'Vocabulary', 'शब्दावली']] },
  ];
  for (const s of subjects) {
    const subject = await prisma.subject.upsert({
      where: { slug: s.slug },
      create: { slug: s.slug, nameEn: s.nameEn, nameHi: s.nameHi },
      update: { nameEn: s.nameEn, nameHi: s.nameHi },
    });
    for (const [slug, nameEn, nameHi] of s.topics) {
      await prisma.topic.upsert({
        where: { subjectId_slug: { subjectId: subject.id, slug } },
        create: { subjectId: subject.id, slug, nameEn, nameHi },
        update: { nameEn, nameHi },
      });
    }
  }

  const ssc = await prisma.exam.findUniqueOrThrow({ where: { slug: 'ssc-cgl' } });
  const jee = await prisma.exam.findUniqueOrThrow({ where: { slug: 'jee-main' } });
  const banking = await prisma.exam.findUniqueOrThrow({ where: { slug: 'banking' } });
  const class10 = await prisma.exam.findUniqueOrThrow({ where: { slug: 'class-10' } });
  const quant = await prisma.subject.findUniqueOrThrow({ where: { slug: 'quantitative-aptitude' }, include: { topics: true } });
  const physics = await prisma.subject.findUniqueOrThrow({ where: { slug: 'physics' }, include: { topics: true } });

  const questions: (Omit<Prisma.QuestionUncheckedCreateInput, 'options'> & { options: [string, string, string | null][] })[] = [
    {
      refId: 'SEED-QA-001', type: 'MCQ_SINGLE', difficulty: 'MEDIUM', status: 'APPROVED', examId: ssc.id, subjectId: quant.id,
      topicId: quant.topics.find((t) => t.slug === 'time-and-work')!.id,
      textEn: 'The ratio of the efficiency of A, B and C is 2 : 3 : 5. Working together, they can complete a task in 6 days. In how many days can A alone complete 20% of the same task?',
      textHi: 'A, B और C की कार्यक्षमता का अनुपात 2 : 3 : 5 है। साथ मिलकर वे एक कार्य 6 दिनों में पूरा कर सकते हैं। A अकेले उसी कार्य का 20% कितने दिनों में पूरा कर सकता है?',
      correctLabels: ['A'], marks: 2, negativeMarks: 0.5,
      solutionEn: 'Total work = (2+3+5) × 6 = 60 units. 20% = 12 units. A does 2 units/day → 6 days.',
      solutionHi: 'कुल कार्य = (2+3+5) × 6 = 60 इकाई। 20% = 12 इकाई। A प्रतिदिन 2 इकाई करता है → 6 दिन।',
      options: [['A', '6 days', '6 दिन'], ['B', '3 days', '3 दिन'], ['C', '12 days', '12 दिन'], ['D', '5 days', '5 दिन']],
    },
    {
      refId: 'SEED-QA-002', type: 'MCQ_SINGLE', difficulty: 'EASY', status: 'APPROVED', examId: ssc.id, subjectId: quant.id,
      topicId: quant.topics.find((t) => t.slug === 'percentages')!.id,
      textEn: 'What is 20% of 150?', textHi: '150 का 20% कितना है?', correctLabels: ['B'], marks: 2, negativeMarks: 0.5,
      options: [['A', '20', null], ['B', '30', null], ['C', '35', null], ['D', '40', null]],
    },
    {
      refId: 'SEED-PHY-001', type: 'MCQ_SINGLE', difficulty: 'HARD', status: 'APPROVED', examId: jee.id, subjectId: physics.id,
      topicId: physics.topics.find((t) => t.slug === 'kinematics')!.id,
      textEn: 'A body is projected at t = 0 with a velocity of 100 m/s at an angle of 60° with the horizontal. Find the radius of curvature of its trajectory when its velocity becomes perpendicular to its initial velocity. ($g = 10\\,m/s^2$)',
      textHi: 'एक पिंड को t = 0 पर 100 m/s के वेग से क्षैतिज से 60° के कोण पर प्रक्षेपित किया जाता है। जब इसका वेग प्रारंभिक वेग के लंबवत हो जाए, तब इसके पथ की वक्रता त्रिज्या ज्ञात कीजिए। ($g = 10\\,m/s^2$)',
      correctLabels: ['D'], marks: 4, negativeMarks: 1,
      options: [['A', '200 m', null], ['B', '250 m', null], ['C', '1000/3 m', null], ['D', '2000/(3√3) m', null]],
    },
    {
      refId: 'SEED-MATH-001', type: 'NUMERIC', difficulty: 'MEDIUM', status: 'IN_REVIEW', examId: class10.id,
      subjectId: (await prisma.subject.findUniqueOrThrow({ where: { slug: 'mathematics' } })).id, classLevel: 10,
      textEn: 'Solve for $x$: $2x + 6 = 20$', textHi: '$x$ का मान ज्ञात करें: $2x + 6 = 20$', correctLabels: [], correctNumeric: 7, numericTolerance: 0,
      marks: 1, negativeMarks: 0, options: [],
    },
    {
      refId: 'SEED-QA-003', type: 'MCQ_MULTI', difficulty: 'MEDIUM', status: 'DRAFT', examId: banking.id, subjectId: quant.id,
      textEn: 'Which of the following numbers are prime?', textHi: null, correctLabels: ['A', 'C'], marks: 2, negativeMarks: 0,
      options: [['A', '13', null], ['B', '21', null], ['C', '29', null], ['D', '33', null]],
    },
  ];
  for (const { options, ...q } of questions) {
    const exists = await prisma.question.findUnique({ where: { refId: q.refId! } });
    if (exists) continue;
    await prisma.question.create({
      data: { ...q, tags: q.tags ?? [], options: { create: options.map(([label, textEn, textHi], i) => ({ label, textEn, textHi, sortOrder: i })) } },
    });
  }

  const sections = [
    ['LIVE_TOURNAMENTS', 'Test Wars', 'टेस्ट वॉर्स'],
    ['CONTINUE_LEARNING', 'Continue Learning', 'पढ़ाई जारी रखें'],
    ['DAILY_MISSIONS', 'Daily Missions', 'दैनिक मिशन'],
    ['POPULAR_EXAMS', 'Popular Exams', 'लोकप्रिय परीक्षाएँ'],
    ['LEADERBOARD', 'Arena Leaderboard', 'एरिना लीडरबोर्ड'],
  ] as const;
  for (const [i, [key, titleEn, titleHi]] of sections.entries()) {
    await prisma.homeSection.upsert({ where: { key }, create: { key, titleEn, titleHi, sortOrder: i }, update: {} });
  }

  if ((await prisma.banner.count()) === 0) {
    await prisma.banner.createMany({
      data: [
        {
          tagEn: 'Test War', tagHi: 'टेस्ट वॉर', titleEn: 'SSC CGL Weekend War', titleHi: 'एसएससी सीजीएल वीकेंड वॉर',
          subtitleEn: '10,000 seats · Free entry · Scholarships for top 50', subtitleHi: '10,000 सीटें · निःशुल्क प्रवेश · शीर्ष 50 को छात्रवृत्ति',
          ctaEn: 'Join now', ctaHi: 'अभी जुड़ें', color: '#1E3A8A', linkType: 'TOURNAMENT', linkTarget: 'ssc-cgl-weekend-war', sortOrder: 0,
        },
        {
          tagEn: 'Limited offer', tagHi: 'सीमित ऑफ़र', titleEn: 'SSC CGL Quant Booster', titleHi: 'एसएससी सीजीएल क्वांट बूस्टर',
          subtitleEn: 'Use WELCOME50 for 50% off your first series', subtitleHi: 'पहली सीरीज़ पर 50% छूट के लिए WELCOME50 लगाएँ',
          ctaEn: 'Grab deal', ctaHi: 'ऑफ़र लें', color: '#F59E0B', linkType: 'SERIES', linkTarget: 'ssc-cgl-quant-pack', sortOrder: 1,
        },
        {
          tagEn: 'School', tagHi: 'स्कूल', titleEn: 'Class 10 Maths Olympiad', titleHi: 'कक्षा 10 गणित ओलंपियाड',
          subtitleEn: 'Certificates for every finisher', subtitleHi: 'हर प्रतिभागी को प्रमाणपत्र',
          ctaEn: 'View', ctaHi: 'देखें', color: '#10B981', linkType: 'TOURNAMENT', linkTarget: 'class-10-maths-olympiad', sortOrder: 2,
        },
      ],
    });
  }

  const commonRules =
    'One attempt per student. The timer runs on our servers and continues if you disconnect. Answers are saved automatically. Use of other devices, apps or help from others leads to disqualification after review.';
  const commonRulesHi =
    'प्रति छात्र एक प्रयास। टाइमर हमारे सर्वर पर चलता है और डिस्कनेक्ट होने पर भी चलता रहता है। उत्तर अपने आप सेव होते हैं। अन्य डिवाइस, ऐप या किसी की मदद लेने पर समीक्षा के बाद अयोग्य घोषित किया जाएगा।';
  const scoring =
    'Correct answer: full marks. Wrong answer: negative marking as shown per question. Ties are broken by (1) higher accuracy, (2) less total time taken, (3) earlier submission.';
  const scoringHi =
    'सही उत्तर: पूर्ण अंक। गलत उत्तर: प्रत्येक प्रश्न पर दिखाए अनुसार ऋणात्मक अंकन। बराबरी होने पर (1) अधिक सटीकता, (2) कम कुल समय, (3) पहले सबमिट करने के आधार पर निर्णय।';
  const refund =
    'Free entry — nothing to refund. If the event is cancelled or fewer than the minimum participants register, it is cancelled and all registrations are released.';
  const refundHi =
    'निःशुल्क प्रवेश — कोई रिफंड नहीं। यदि आयोजन रद्द होता है या न्यूनतम से कम प्रतिभागी पंजीकरण करते हैं, तो इसे रद्द कर दिया जाएगा।';

  const tournaments: Prisma.TournamentUncheckedCreateInput[] = [
    {
      slug: 'ssc-cgl-weekend-war', titleEn: 'SSC CGL Weekend War', titleHi: 'एसएससी सीजीएल वीकेंड वॉर', examId: ssc.id,
      descriptionEn: 'A full-length SSC CGL Tier 1 mock under real exam conditions, ranked against thousands of aspirants.',
      descriptionHi: 'वास्तविक परीक्षा जैसी परिस्थितियों में एसएससी सीजीएल टियर 1 का पूर्ण मॉक, हज़ारों अभ्यर्थियों के साथ रैंकिंग।',
      rulesEn: commonRules, rulesHi: commonRulesHi, scoringEn: scoring, scoringHi: scoringHi, refundPolicyEn: refund, refundPolicyHi: refundHi,
      status: 'REG_OPEN', format: 'MASS', entryMode: 'FREE', entryFeePaise: 0, rewardType: 'SCHOLARSHIP', fundingSource: 'SPONSOR', sponsorName: 'Testwise',
      prizeTiers: [
        { fromRank: 1, toRank: 1, amountPaise: 0, rewardEn: '1-year Pro pass + trophy', rewardHi: '1 साल का प्रो पास + ट्रॉफी' },
        { fromRank: 2, toRank: 10, amountPaise: 0, rewardEn: '6-month Pro pass', rewardHi: '6 महीने का प्रो पास' },
        { fromRank: 11, toRank: 50, amountPaise: 0, rewardEn: '1-month Pro pass', rewardHi: '1 महीने का प्रो पास' },
      ],
      maxParticipants: 10000, minParticipants: 100,
      registrationOpensAt: at(-2), registrationClosesAt: at(3, 17), startsAt: at(3, 18), endsAt: at(3, 20),
      durationMinutes: 60, questionCount: 100, eligibility: { audience: ['EXAM'], classLevels: [], requiresVerifiedEmail: false },
      bannerColor: '#1E3A8A', featured: true, publishedAt: at(-2),
    },
    {
      slug: 'jee-physics-sprint', titleEn: 'JEE Physics Sprint', titleHi: 'जेईई भौतिकी स्प्रिंट', examId: jee.id,
      descriptionEn: '30 high-yield physics questions in 45 minutes.', descriptionHi: '45 मिनट में 30 महत्वपूर्ण भौतिकी प्रश्न।',
      rulesEn: commonRules, rulesHi: commonRulesHi, scoringEn: scoring, scoringHi: scoringHi, refundPolicyEn: refund, refundPolicyHi: refundHi,
      status: 'SCHEDULED', format: 'MASS', entryMode: 'FREE', entryFeePaise: 0, rewardType: 'VOUCHER', fundingSource: 'PLATFORM',
      prizeTiers: [{ fromRank: 1, toRank: 3, amountPaise: 0, rewardEn: 'Book voucher', rewardHi: 'पुस्तक वाउचर' }],
      maxParticipants: 2000, minParticipants: 50,
      registrationOpensAt: at(1, 10), registrationClosesAt: at(6, 17), startsAt: at(6, 18), endsAt: at(6, 19),
      durationMinutes: 45, questionCount: 30, eligibility: { audience: [], classLevels: [11, 12], requiresVerifiedEmail: false },
      bannerColor: '#312E81', featured: false, publishedAt: at(-1),
    },
    {
      slug: 'class-10-maths-olympiad', titleEn: 'Class 10 Maths Olympiad', titleHi: 'कक्षा 10 गणित ओलंपियाड', examId: class10.id,
      descriptionEn: 'Board-aligned maths challenge for Class 10. Certificates for all finishers.', descriptionHi: 'कक्षा 10 के लिए बोर्ड पाठ्यक्रम आधारित गणित चुनौती।',
      rulesEn: commonRules, rulesHi: commonRulesHi, scoringEn: scoring, scoringHi: scoringHi, refundPolicyEn: refund, refundPolicyHi: refundHi,
      status: 'REG_OPEN', format: 'MASS', entryMode: 'FREE', entryFeePaise: 0, rewardType: 'MIXED', fundingSource: 'SPONSOR', sponsorName: 'Testwise',
      prizeTiers: [
        { fromRank: 1, toRank: 1, amountPaise: 0, rewardEn: 'Scholarship certificate + medal', rewardHi: 'छात्रवृत्ति प्रमाणपत्र + पदक' },
        { fromRank: 2, toRank: 25, amountPaise: 0, rewardEn: 'Merit certificate', rewardHi: 'मेरिट प्रमाणपत्र' },
      ],
      maxParticipants: 5000, minParticipants: 50,
      registrationOpensAt: at(-1), registrationClosesAt: at(5, 16), startsAt: at(5, 17), endsAt: at(5, 18),
      durationMinutes: 40, questionCount: 25, eligibility: { audience: ['SCHOOL'], classLevels: [10], requiresVerifiedEmail: false },
      bannerColor: '#065F46', featured: true, publishedAt: at(-1),
    },
    {
      slug: 'banking-prelims-draft', titleEn: 'Banking Prelims Grand Test', examId: banking.id,
      status: 'DRAFT', format: 'MASS', entryMode: 'PAID', entryFeePaise: 4900, rewardType: 'CASH', fundingSource: 'ENTRY_FEES',
      prizeTiers: [{ fromRank: 1, toRank: 1, amountPaise: 500000 }, { fromRank: 2, toRank: 5, amountPaise: 100000 }],
      maxParticipants: 1000, minParticipants: 200,
      registrationOpensAt: at(7), registrationClosesAt: at(12, 17), startsAt: at(12, 18), endsAt: at(12, 19),
      durationMinutes: 60, questionCount: 100, eligibility: { audience: ['EXAM'], classLevels: [], minAge: 18, requiresVerifiedEmail: true },
      bannerColor: '#7C2D12', featured: false, prizePoolPaise: 900000,
    },
  ];
  for (const t of tournaments) {
    await prisma.tournament.upsert({ where: { slug: t.slug }, create: t, update: {} });
  }


  // ---------- Practice content: approved bilingual questions generated from templates
  const maths = await prisma.subject.findUniqueOrThrow({ where: { slug: 'mathematics' }, include: { topics: true } });
  const pct = quant.topics.find((t) => t.slug === 'percentages')!;
  const ratio = quant.topics.find((t) => t.slug === 'ratio')!;
  const kin = physics.topics.find((t) => t.slug === 'kinematics')!;
  const alg = maths.topics.find((t) => t.slug === 'algebra')!;
  const gen: (Omit<Prisma.QuestionUncheckedCreateInput, 'options'> & { options: [string, string, string | null][] })[] = [];
  const shuffleOpts = (correct: number, distractors: number[]) => {
    const vals = [correct, ...distractors].slice(0, 4);
    const order = [...vals].sort((a, b) => (a * 7919) % 13 - (b * 7919) % 13);
    const labels = ['A', 'B', 'C', 'D'];
    return { opts: order.map((v, i) => [labels[i], String(v), null] as [string, string, null]), label: labels[order.indexOf(correct)] };
  };
  const pctPairs = [[10, 250], [15, 360], [25, 480], [12, 150], [40, 85], [5, 920], [30, 270], [18, 450], [35, 600], [8, 375], [22, 500], [45, 220]];
  pctPairs.forEach(([p, n], i) => {
    const ans = (p * n) / 100;
    const { opts, label } = shuffleOpts(ans, [ans + 5, Math.max(1, ans - 3), ans * 2]);
    gen.push({
      refId: `SEED-PCT-${String(i + 1).padStart(3, '0')}`, type: 'MCQ_SINGLE', difficulty: i < 6 ? 'EASY' : 'MEDIUM', status: 'APPROVED',
      examId: ssc.id, subjectId: quant.id, topicId: pct.id, textEn: `What is ${p}% of ${n}?`, textHi: `${n} का ${p}% कितना है?`,
      correctLabels: [label], marks: 2, negativeMarks: 0.5, solutionEn: `${p}/100 × ${n} = ${ans}`, solutionHi: `${p}/100 × ${n} = ${ans}`, options: opts, source: 'Testwise seed',
    });
  });
  const ratios = [[2, 3, 50], [3, 5, 64], [1, 4, 45], [5, 7, 96], [4, 9, 130], [7, 3, 80]];
  ratios.forEach(([a, b, total], i) => {
    const ans = (a * total) / (a + b);
    const { opts, label } = shuffleOpts(ans, [(b * total) / (a + b), ans + 4, Math.max(1, ans - 6)]);
    gen.push({
      refId: `SEED-RAT-${String(i + 1).padStart(3, '0')}`, type: 'MCQ_SINGLE', difficulty: 'MEDIUM', status: 'APPROVED', examId: ssc.id,
      subjectId: quant.id, topicId: ratio.id, textEn: `₹${total} is divided between A and B in the ratio ${a} : ${b}. What is A's share?`,
      textHi: `₹${total} को A और B के बीच ${a} : ${b} के अनुपात में बाँटा जाता है। A का हिस्सा कितना है?`, correctLabels: [label], marks: 2, negativeMarks: 0.5,
      solutionEn: `A = ${a}/(${a}+${b}) × ${total} = ${ans}`, solutionHi: `A = ${a}/(${a}+${b}) × ${total} = ${ans}`, options: opts, source: 'Testwise seed',
    });
  });
  const kinem = [[0, 2, 5], [4, 3, 6], [10, 1, 8], [2, 4, 5], [6, 2, 7], [0, 5, 4], [8, 3, 4], [1, 2, 9]];
  kinem.forEach(([u, a, t], i) => {
    const v = u + a * t;
    gen.push({
      refId: `SEED-KIN-${String(i + 1).padStart(3, '0')}`, type: 'NUMERIC', difficulty: i < 4 ? 'EASY' : 'MEDIUM', status: 'APPROVED', examId: jee.id,
      subjectId: physics.id, topicId: kin.id, textEn: `A body starts with velocity $u = ${u}\\,m/s$ and accelerates uniformly at $a = ${a}\\,m/s^2$. Find its velocity (in m/s) after $t = ${t}\\,s$.`,
      textHi: `एक पिंड $u = ${u}\\,m/s$ वेग से चलना शुरू करता है और $a = ${a}\\,m/s^2$ के एकसमान त्वरण से चलता है। $t = ${t}\\,s$ के बाद इसका वेग (m/s में) ज्ञात कीजिए।`,
      correctLabels: [], correctNumeric: v, numericTolerance: 0, marks: 4, negativeMarks: 1, solutionEn: `v = u + at = ${u} + ${a}×${t} = ${v} m/s`, solutionHi: `v = u + at = ${u} + ${a}×${t} = ${v} m/s`, options: [], source: 'Testwise seed',
    });
  });
  const lin = [[3, 4, 19], [5, 2, 27], [2, 9, 21], [4, 1, 33], [6, 3, 45], [7, 5, 40], [9, 2, 74], [8, 6, 46], [3, 11, 32], [5, 5, 50]];
  lin.forEach(([a, b, c], i) => {
    const x = (c - b) / a;
    gen.push({
      refId: `SEED-LIN-${String(i + 1).padStart(3, '0')}`, type: 'NUMERIC', difficulty: 'EASY', status: 'APPROVED', examId: class10.id, classLevel: 10,
      subjectId: maths.id, topicId: alg.id, textEn: `Solve for $x$: $${a}x + ${b} = ${c}$`, textHi: `$x$ का मान ज्ञात करें: $${a}x + ${b} = ${c}$`,
      correctLabels: [], correctNumeric: x, numericTolerance: 0.01, marks: 1, negativeMarks: 0, solutionEn: `${a}x = ${c - b} ⇒ x = ${x}`, solutionHi: `${a}x = ${c - b} ⇒ x = ${x}`, options: [], source: 'Testwise seed',
    });
  });
  for (const { options, ...q } of gen) {
    if (await prisma.question.findUnique({ where: { refId: q.refId! } })) continue;
    await prisma.question.create({ data: { ...q, tags: [], options: { create: options.map(([label, textEn, textHi], i) => ({ label, textEn, textHi, sortOrder: i })) } } });
  }
  const byPrefix = (prefix: string) => prisma.question.findMany({ where: { refId: { startsWith: prefix }, status: 'APPROVED' }, orderBy: { refId: 'asc' }, select: { id: true } });

  async function ensureTest(title: { en: string; hi: string }, opts: Omit<Prisma.TestUncheckedCreateInput, 'titleEn' | 'titleHi'>, sections: { en: string; hi: string; ids: string[] }[]) {
    const existing = await prisma.test.findFirst({ where: { titleEn: title.en } });
    if (existing) return existing;
    const t = await prisma.test.create({ data: { ...opts, titleEn: title.en, titleHi: title.hi, status: 'PUBLISHED', publishedAt: new Date() } });
    for (const [si, s] of sections.entries()) {
      const sec = await prisma.testSection.create({ data: { testId: t.id, titleEn: s.en, titleHi: s.hi, sortOrder: si } });
      await prisma.testQuestion.createMany({ data: s.ids.map((questionId, i) => ({ testId: t.id, sectionId: sec.id, questionId, sortOrder: i })) });
    }
    return t;
  }
  const instructionsEn = 'Each question shows its marks and negative marks. The timer runs on our servers; your answers save automatically and the test submits itself when time is up.';
  const instructionsHi = 'हर प्रश्न पर अंक और ऋणात्मक अंक दिखाए गए हैं। टाइमर हमारे सर्वर पर चलता है; आपके उत्तर अपने आप सेव होते हैं और समय समाप्त होने पर टेस्ट अपने आप जमा हो जाता है।';
  const pctIds = (await byPrefix('SEED-PCT')).map((q) => q.id);
  const ratIds = (await byPrefix('SEED-RAT')).map((q) => q.id);
  const sscMock = await ensureTest({ en: 'SSC CGL Quant Mock 1', hi: 'एसएससी सीजीएल क्वांट मॉक 1' }, { examId: ssc.id, kind: 'MOCK', durationMinutes: 20, shuffleQuestions: true, shuffleOptions: true, answerKeyPolicy: 'ON_SUBMIT', maxAttempts: 3, instructionsEn, instructionsHi },
    [{ en: 'Percentages', hi: 'प्रतिशत', ids: pctIds.slice(0, 8) }, { en: 'Ratio & Proportion', hi: 'अनुपात और समानुपात', ids: ratIds }]);
  const sscSectional = await ensureTest({ en: 'Percentages Sectional', hi: 'प्रतिशत सेक्शनल' }, { examId: ssc.id, kind: 'SECTIONAL', durationMinutes: 10, answerKeyPolicy: 'ON_SUBMIT', maxAttempts: 5, instructionsEn, instructionsHi },
    [{ en: 'Percentages', hi: 'प्रतिशत', ids: pctIds }]);
  const sscWar = await ensureTest({ en: 'SSC CGL Weekend War Paper', hi: 'एसएससी सीजीएल वीकेंड वॉर पेपर' }, { examId: ssc.id, kind: 'TOURNAMENT', durationMinutes: 15, shuffleQuestions: true, shuffleOptions: true, answerKeyPolicy: 'AFTER_FINAL', maxAttempts: 1, instructionsEn, instructionsHi },
    [{ en: 'Quantitative Aptitude', hi: 'मात्रात्मक योग्यता', ids: [...pctIds.slice(4), ...ratIds.slice(0, 4)] }]);
  const jeeTest = await ensureTest({ en: 'JEE Kinematics Sprint Paper', hi: 'जेईई शुद्धगतिकी स्प्रिंट पेपर' }, { examId: jee.id, kind: 'TOURNAMENT', durationMinutes: 15, answerKeyPolicy: 'AFTER_WINDOW', maxAttempts: 1, instructionsEn, instructionsHi },
    [{ en: 'Kinematics', hi: 'शुद्धगतिकी', ids: (await byPrefix('SEED-KIN')).map((q) => q.id) }]);
  const linIds = (await byPrefix('SEED-LIN')).map((q) => q.id);
  const c10Test = await ensureTest({ en: 'Class 10 Algebra Olympiad Paper', hi: 'कक्षा 10 बीजगणित ओलंपियाड पेपर' }, { examId: class10.id, kind: 'TOURNAMENT', durationMinutes: 15, answerKeyPolicy: 'AFTER_FINAL', maxAttempts: 1, instructionsEn, instructionsHi },
    [{ en: 'Algebra', hi: 'बीजगणित', ids: linIds }]);
  const c10Practice = await ensureTest({ en: 'Linear Equations Practice', hi: 'रैखिक समीकरण अभ्यास' }, { examId: class10.id, kind: 'PRACTICE', durationMinutes: 10, answerKeyPolicy: 'ON_SUBMIT', maxAttempts: 10, instructionsEn, instructionsHi },
    [{ en: 'Algebra', hi: 'बीजगणित', ids: linIds.slice(0, 6) }]);

  await prisma.tournament.update({ where: { slug: 'ssc-cgl-weekend-war' }, data: { testId: sscWar.id, durationMinutes: 15, questionCount: 12 } });
  await prisma.tournament.update({ where: { slug: 'jee-physics-sprint' }, data: { testId: jeeTest.id, durationMinutes: 15, questionCount: 8 } });
  await prisma.tournament.update({ where: { slug: 'class-10-maths-olympiad' }, data: { testId: c10Test.id, durationMinutes: 15, questionCount: 10 } });

  async function ensureSeries(data: Omit<Prisma.TestSeriesUncheckedCreateInput, 'status'>, tests: { id: string; free?: boolean }[]) {
    const s = await prisma.testSeries.upsert({ where: { slug: data.slug }, create: { ...data, status: 'PUBLISHED' }, update: {} });
    if ((await prisma.seriesTest.count({ where: { seriesId: s.id } })) === 0) {
      await prisma.seriesTest.createMany({ data: tests.map((t, i) => ({ seriesId: s.id, testId: t.id, freePreview: !!t.free, sortOrder: i })) });
    }
  }
  await ensureSeries(
    {
      slug: 'ssc-cgl-quant-pack', titleEn: 'SSC CGL Quant Booster', titleHi: 'एसएससी सीजीएल क्वांट बूस्टर', examId: ssc.id, pricePaise: 19900, mrpPaise: 49900, validityDays: 180,
      color: '#F59E0B', badgeEn: 'Best seller', badgeHi: 'बेस्ट सेलर', featured: true, sortOrder: 0,
      descriptionEn: 'Full mocks and sectionals for SSC CGL Tier 1 quantitative aptitude, with step-by-step solutions in English and Hindi.',
      descriptionHi: 'एसएससी सीजीएल टियर 1 मात्रात्मक योग्यता के लिए पूर्ण मॉक और सेक्शनल, अंग्रेज़ी और हिन्दी में चरण-दर-चरण समाधान के साथ।',
      features: [{ en: 'Bilingual questions & solutions', hi: 'द्विभाषी प्रश्न और समाधान' }, { en: 'Up to 5 attempts per test', hi: 'हर टेस्ट के लिए 5 प्रयास तक' }, { en: 'Topic-wise accuracy analysis', hi: 'विषयवार सटीकता विश्लेषण' }],
    },
    [{ id: sscSectional.id, free: true }, { id: sscMock.id }],
  );
  await ensureSeries(
    {
      slug: 'class-10-maths-free', titleEn: 'Class 10 Maths Practice', titleHi: 'कक्षा 10 गणित अभ्यास', examId: class10.id, pricePaise: 0, validityDays: 365,
      color: '#10B981', badgeEn: 'Free', badgeHi: 'निःशुल्क', sortOrder: 1,
      descriptionEn: 'Free board-aligned practice for Class 10 algebra.', descriptionHi: 'कक्षा 10 बीजगणित के लिए बोर्ड पाठ्यक्रम आधारित निःशुल्क अभ्यास।',
      features: [{ en: 'Instant solutions after each test', hi: 'हर टेस्ट के बाद तुरंत समाधान' }],
    },
    [{ id: c10Practice.id }],
  );

  await prisma.coupon.upsert({ where: { code: 'WELCOME50' }, create: { code: 'WELCOME50', descriptionEn: '50% off your first test series', percentOff: 50, appliesTo: 'SERIES', maxUses: 1000 }, update: {} });

  if ((await prisma.faq.count()) === 0) {
    await prisma.faq.createMany({
      data: [
        { category: 'Tournaments', sortOrder: 0, questionEn: 'How is my rank calculated?', questionHi: 'मेरी रैंक कैसे तय होती है?', answerEn: 'By score first, then higher accuracy, then less time taken, then earlier submission. The rules are shown on every tournament page.', answerHi: 'पहले अंक, फिर अधिक सटीकता, फिर कम समय, फिर पहले जमा करने के आधार पर। नियम हर टूर्नामेंट पेज पर दिखाए जाते हैं।' },
        { category: 'Tournaments', sortOrder: 1, questionEn: 'When do results become official?', questionHi: 'परिणाम कब आधिकारिक होते हैं?', answerEn: 'Provisional results appear after the test window closes. After the review period they are finalised and get a public verification link.', answerHi: 'टेस्ट विंडो बंद होने के बाद अनंतिम परिणाम आते हैं। समीक्षा अवधि के बाद वे अंतिम होते हैं और उनका सार्वजनिक सत्यापन लिंक बनता है।' },
        { category: 'Tests', sortOrder: 0, questionEn: 'What happens if my internet disconnects?', questionHi: 'अगर मेरा इंटरनेट बंद हो जाए तो क्या होगा?', answerEn: 'Your answers are saved on your phone and synced when you reconnect. The timer keeps running on our servers.', answerHi: 'आपके उत्तर फ़ोन पर सेव रहते हैं और दोबारा जुड़ने पर सिंक हो जाते हैं। टाइमर हमारे सर्वर पर चलता रहता है।' },
        { category: 'Payments', sortOrder: 0, questionEn: 'How do refunds work?', questionHi: 'रिफंड कैसे होता है?', answerEn: 'If a tournament is cancelled you are refunded automatically to the original payment method. Other refund requests can be raised from Help & support.', answerHi: 'टूर्नामेंट रद्द होने पर राशि अपने आप मूल भुगतान माध्यम में लौटा दी जाती है। अन्य रिफंड अनुरोध सहायता से भेजे जा सकते हैं।' },
        { category: 'Account', sortOrder: 0, questionEn: 'How do I delete my account?', questionHi: 'मैं अपना खाता कैसे हटाऊँ?', answerEn: 'Go to Profile → Privacy & data → Delete account. Our team completes the request after checking for pending refunds or rewards.', answerHi: 'प्रोफ़ाइल → गोपनीयता और डेटा → खाता हटाएँ पर जाएँ। लंबित रिफंड या पुरस्कार जाँचने के बाद हमारी टीम अनुरोध पूरा करती है।' },
      ],
    });
  }


  // ---------- Duel bot personas (admin-managed; shown like normal players)
  if ((await prisma.botPersona.count()) === 0) {
    const names: [string, string, number, number][] = [
      ['Aarav Mehta', 'Pune', 900, 1300], ['Ishita Rao', 'Hyderabad', 1000, 1400], ['Kabir Malhotra', 'Delhi', 1100, 1500], ['Ananya Iyer', 'Chennai', 1200, 1600],
      ['Rohan Verma', 'Lucknow', 900, 1250], ['Sneha Kulkarni', 'Nagpur', 1050, 1450], ['Vihaan Gupta', 'Jaipur', 1150, 1550], ['Diya Sharma', 'Bhopal', 950, 1350],
      ['Arjun Nair', 'Kochi', 1250, 1700], ['Meera Joshi', 'Indore', 1000, 1400], ['Aditya Singh', 'Patna', 1100, 1500], ['Kavya Reddy', 'Vijayawada', 1200, 1650],
      ['Siddharth Das', 'Kolkata', 1300, 1800], ['Riya Patel', 'Ahmedabad', 900, 1300], ['Harsh Yadav', 'Kanpur', 1000, 1450], ['Tanvi Bhat', 'Mangaluru', 1150, 1600],
      ['Yash Choudhary', 'Chandigarh', 1250, 1750], ['Pooja Mishra', 'Varanasi', 950, 1350], ['Nikhil Saxena', 'Gwalior', 1100, 1550], ['Aisha Khan', 'Srinagar', 1200, 1700],
    ];
    const colors = ['#F97316', '#EC4899', '#8B5CF6', '#FACC15', '#22D3EE', '#10B981'];
    await prisma.botPersona.createMany({ data: names.map(([name, city, ratingMin, ratingMax], i) => ({ name, city, ratingMin, ratingMax, color: colors[i % colors.length] })) });
  }
  if (!(await prisma.faq.findFirst({ where: { questionEn: { startsWith: 'Who do I play against in 1v1 duels' } } }))) {
    await prisma.faq.create({
      data: {
        category: 'Duels', sortOrder: 0,
        questionEn: 'Who do I play against in 1v1 duels?', questionHi: '1v1 मुकाबलों में मेरा प्रतिद्वंद्वी कौन होता है?',
        answerEn: 'We match you with a student of similar rating. If nobody is available quickly, practice duels may use a computer-controlled opponent. Duels are free, carry no cash or prizes, and never count towards tournament results.',
        answerHi: 'हम आपको समान रेटिंग वाले छात्र से मिलाते हैं। यदि जल्दी कोई उपलब्ध न हो, तो अभ्यास मुकाबलों में कंप्यूटर-नियंत्रित प्रतिद्वंद्वी हो सकता है। मुकाबले निःशुल्क हैं, इनमें कोई नकद या पुरस्कार नहीं होता और ये टूर्नामेंट परिणामों में नहीं गिने जाते।',
      },
    });
  }

  // Wallet: coin packs and a starter rewards catalog (the wallet itself stays off until enabled in Settings).
  if ((await prisma.coinPack.count()) === 0) {
    await prisma.coinPack.createMany({
      data: [
        { titleEn: 'Starter', titleHi: 'स्टार्टर', coins: 500, bonusCoins: 0, pricePaise: 5_000, sortOrder: 1 },
        { titleEn: 'Value', titleHi: 'वैल्यू', coins: 1_000, bonusCoins: 100, pricePaise: 10_000, badgeEn: '+10% bonus', badgeHi: '+10% बोनस', sortOrder: 2 },
        { titleEn: 'Pro', titleHi: 'प्रो', coins: 2_500, bonusCoins: 400, pricePaise: 25_000, badgeEn: 'Best value', badgeHi: 'सबसे फ़ायदेमंद', sortOrder: 3 },
      ],
    });
  }
  if ((await prisma.rewardItem.count()) === 0) {
    await prisma.rewardItem.create({
      data: {
        kind: 'MERCH', titleEn: 'Testwise Hoodie', titleHi: 'Testwise हुडी', descriptionEn: 'Navy fleece hoodie with the Arena logo. Delivered in 7–10 days.', descriptionHi: 'एरीना लोगो वाली नेवी फ़्लीस हुडी। 7–10 दिनों में डिलीवरी।',
        coinCost: 12_000, costPaise: 65_000, valuePaise: 0, variants: ['S', 'M', 'L', 'XL'], stock: 50, perUserLimit: 2, requiresAddress: true, sortOrder: 1,
      },
    });
    await prisma.rewardItem.create({
      data: {
        kind: 'MERCH', titleEn: 'Goodies kit', titleHi: 'गुडीज़ किट', descriptionEn: 'Notebook, pen set, stickers and a bottle.', descriptionHi: 'नोटबुक, पेन सेट, स्टिकर और बोतल।',
        coinCost: 5_000, costPaise: 30_000, stock: 100, perUserLimit: 3, requiresAddress: true, sortOrder: 2,
      },
    });
    const voucher = await prisma.rewardItem.create({
      data: {
        kind: 'VOUCHER', titleEn: '₹100 shopping voucher', titleHi: '₹100 शॉपिंग वाउचर', brand: 'Sample', descriptionEn: 'Instant e-voucher, delivered in the app.', descriptionHi: 'तुरंत ई-वाउचर, ऐप में मिलेगा।',
        termsEn: 'Valid for 12 months. Sample codes for testing only.', coinCost: 1_200, valuePaise: 10_000, costPaise: 9_500, perUserLimit: 5, autoApprove: true, sortOrder: 3,
      },
    });
    await prisma.voucherCode.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ rewardId: voucher.id, code: `SAMPLE-TW-${String(i + 1).padStart(4, '0')}` })) });
    await prisma.rewardItem.create({
      data: {
        kind: 'UPI_CASH', titleEn: '₹100 to UPI', titleHi: '₹100 UPI पर', descriptionEn: 'Paid to your UPI ID after review, usually within 2 working days. Earned coins only.', descriptionHi: 'समीक्षा के बाद आपके UPI ID पर, आम तौर पर 2 कार्यदिवस में। केवल अर्जित कॉइन।',
        coinCost: 1_100, valuePaise: 10_000, costPaise: 10_000, allowPurchasedCoins: false, perUserLimit: 10, sortOrder: 4,
      },
    });
  }
  for (const faq of [
    {
      category: 'Wallet', sortOrder: 0,
      questionEn: 'What is the difference between purchased and earned coins?', questionHi: 'खरीदे और अर्जित कॉइन में क्या अंतर है?',
      answerEn: 'Purchased coins come from top-ups and can be used for merchandise and vouchers. Earned coins come from prizes and rewards; only earned coins can be paid out to UPI. Coins cannot be transferred to other students.',
      answerHi: 'खरीदे गए कॉइन टॉप-अप से आते हैं और मर्चेंडाइज़ व वाउचर के लिए उपयोग होते हैं। अर्जित कॉइन पुरस्कारों से मिलते हैं; केवल अर्जित कॉइन ही UPI पर भेजे जा सकते हैं। कॉइन दूसरे छात्रों को नहीं भेजे जा सकते।',
    },
    {
      category: 'Exams', sortOrder: 0,
      questionEn: 'What happens in a proctored test?', questionHi: 'निगरानी वाले टेस्ट में क्या होता है?',
      answerEn: 'Before the test we check your phone for screen-sharing or remote-control apps and ask for camera and microphone access. During the test the app checks on your phone that you are alone and quiet, takes occasional snapshots, and may record a short audio clip if speech is detected. In live-proctored tests a proctor may watch your camera and hear your microphone. Flags are reviewed by a person before any penalty, and you can appeal from Help & support. Snapshots and clips are deleted after the retention period.',
      answerHi: 'टेस्ट से पहले हम आपके फ़ोन में स्क्रीन-शेयरिंग या रिमोट-कंट्रोल ऐप की जाँच करते हैं और कैमरा व माइक की अनुमति माँगते हैं। टेस्ट के दौरान ऐप आपके फ़ोन पर जाँचता है कि आप अकेले और शांत हैं, कभी-कभी स्नैपशॉट लेता है, और बोलने की आवाज़ आने पर छोटी ऑडियो क्लिप रिकॉर्ड कर सकता है। लाइव निगरानी वाले टेस्ट में निरीक्षक आपका कैमरा देख और माइक सुन सकते हैं। किसी भी दंड से पहले एक व्यक्ति समीक्षा करता है, और आप सहायता से अपील कर सकते हैं। स्नैपशॉट और क्लिप तय अवधि के बाद हटा दिए जाते हैं।',
    },
  ]) {
    if (!(await prisma.faq.findFirst({ where: { questionEn: faq.questionEn } }))) await prisma.faq.create({ data: faq });
  }

  console.log(`Seed complete. Admin login: ${email} / ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
