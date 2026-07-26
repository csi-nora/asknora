import type { Sector } from '../models';

const baseContext = (name: string) =>
  `You are Nora, Singtel CSI enterprise portfolio advisor for the ${name} sector. ` +
  'Ground answers in Singtel Cyber Security Institute programmes (Elevate, cyber range, IT/OT, TTX), ' +
  'SkillsFuture pathways, and uploaded RAG documents. Be concise and cite sources when available.';

export const SECTORS: Record<string, Sector> = {
  healthcare: {
    name: 'Healthcare',
    icon: '🏥',
    desc: 'Clinical systems, PDPA, and cyber resilience for healthcare operators.',
    count: 12,
    services: [
      { tag: 'Elevate', color: '#22C55E', bg: 'rgba(34,197,94,.12)' },
      { tag: 'OT/IoT', color: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
      { tag: 'TTX', color: '#F59E0B', bg: 'rgba(245,158,11,.12)' },
    ],
    quickPrompts: [
      'How does CSI Elevate help healthcare CISOs?',
      'Summarise PDPA considerations for hospital IT.',
      'What OT security offerings apply to medical devices?',
    ],
    context: baseContext('Healthcare') + ' Emphasise patient data protection, HA/DR, and CSA healthcare guidance.',
  },
  financial: {
    name: 'Financial Services',
    icon: '🏦',
    desc: 'MAS TRM, fraud, and resilience for banks and insurers.',
    count: 18,
    services: [
      { tag: 'MAS TRM', color: '#A855F7', bg: 'rgba(168,85,247,.12)' },
      { tag: 'SOC', color: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
      { tag: 'Range', color: '#E0001A', bg: 'rgba(224,0,26,.12)' },
    ],
    quickPrompts: [
      'Map CSI offerings to MAS TRM pillars.',
      'Recommend cyber range exercises for a bank SOC.',
      'What training paths support financial sector talent?',
    ],
    context: baseContext('Financial Services') + ' Reference MAS notices, fraud analytics, and third-party risk.',
  },
  government: {
    name: 'Government',
    icon: '🏛️',
    desc: 'Public sector cyber uplift, GCC, and national resilience.',
    count: 15,
    services: [
      { tag: 'IM8', color: '#22C55E', bg: 'rgba(34,197,94,.12)' },
      { tag: 'GCC', color: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
      { tag: 'Queen Bee', color: '#F59E0B', bg: 'rgba(245,158,11,.12)' },
    ],
    quickPrompts: [
      'How does Singtel CSI support public sector agencies?',
      'Outline SkillsFuture Queen Bee for government teams.',
      'What tabletop exercises suit government SOCs?',
    ],
    context: baseContext('Government') + ' Cover IM8, GCC hosting, and whole-of-government cyber programmes.',
  },
  sme: {
    name: 'SME',
    icon: '💼',
    desc: 'Affordable cyber uplift and managed services for growing businesses.',
    count: 22,
    services: [
      { tag: 'Elevate SME', color: '#E0001A', bg: 'rgba(224,0,26,.12)' },
      { tag: 'MSS', color: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
      { tag: 'Training', color: '#22C55E', bg: 'rgba(34,197,94,.12)' },
    ],
    quickPrompts: [
      'What CSI packages fit a 50-person SME?',
      'Compare managed SOC vs in-house for SMEs.',
      'SkillsFuture credits for cyber training?',
    ],
    context: baseContext('SME') + ' Focus on cost-effective uplift, phishing resilience, and SkillsFuture funding.',
  },
  manufacturing: {
    name: 'Manufacturing',
    icon: '🏭',
    desc: 'IT/OT convergence, smart factories, and supply-chain security.',
    count: 14,
    services: [
      { tag: 'OT Security', color: '#F59E0B', bg: 'rgba(245,158,11,.12)' },
      { tag: 'IoT', color: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
      { tag: 'Consulting', color: '#A855F7', bg: 'rgba(168,85,247,.12)' },
    ],
    quickPrompts: [
      'How does Singtel secure OT in manufacturing plants?',
      'Recommend IT/OT segmentation for a factory.',
      'CSI training for plant engineers?',
    ],
    context: baseContext('Manufacturing') + ' Highlight OT/IoT, IEC 62443 concepts, and supply-chain risk.',
  },
  retail: {
    name: 'Retail',
    icon: '🛒',
    desc: 'E-commerce, POS, and customer data protection for retailers.',
    count: 11,
    services: [
      { tag: 'PCI', color: '#22C55E', bg: 'rgba(34,197,94,.12)' },
      { tag: 'Fraud', color: '#E0001A', bg: 'rgba(224,0,26,.12)' },
      { tag: 'Cloud', color: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
    ],
    quickPrompts: [
      'PCI-DSS considerations for omnichannel retail.',
      'How can CSI help with e-commerce fraud?',
      'Quick wins for retail phishing awareness.',
    ],
    context: baseContext('Retail') + ' Cover PCI, loyalty data, and peak-season DDoS readiness.',
  },
};

export const SECTOR_KEYS = Object.keys(SECTORS);
