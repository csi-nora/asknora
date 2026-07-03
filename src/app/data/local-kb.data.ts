import type { KbChunk } from '../models';

export const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our',
  'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see',
  'way', 'who', 'did', 'let', 'say', 'she', 'too', 'use', 'with', 'this', 'that', 'from',
  'have', 'what', 'when', 'your', 'about', 'into', 'than', 'them', 'then', 'some', 'such',
  'will', 'also', 'been', 'being', 'over', 'more', 'most', 'other', 'only', 'their', 'there',
]);

const shared: KbChunk[] = [
  {
    id: 'csi-overview',
    tags: ['csi', 'singtel', 'elevate', 'institute'],
    title: 'Singtel Cyber Security Institute (CSI)',
    answer:
      'Singtel CSI is a regional cyber training and resilience institute offering Elevate programmes, ' +
      'cyber range exercises, IT/OT security, tabletop (TTX) scenarios, and executive education aligned to Singapore regulatory context.',
  },
  {
    id: 'skillsfuture',
    tags: ['skillsfuture', 'training', 'funding', 'ssg'],
    title: 'SkillsFuture & workforce uplift',
    answer:
      'Public SkillsFuture initiatives support mid-career and sector-specific cyber training. ' +
      'CSI partners with institutes such as SIM Academy on programmes like AI.dea and cyber resilience courses.',
  },
];

function sectorChunks(
  sector: string,
  title: string,
  answer: string,
  tags: string[],
): KbChunk[] {
  return [
    ...shared,
    {
      id: `${sector}-focus`,
      tags: [sector, ...tags],
      title,
      answer,
    },
  ];
}

export const LOCAL_KB: Record<string, KbChunk[]> = {
  healthcare: sectorChunks(
    'healthcare',
    'Healthcare cyber priorities',
    'Healthcare organisations prioritise clinical continuity, PDPA-compliant data handling, medical device security, and incident response playbooks validated through CSI tabletop exercises.',
    ['health', 'pdpa', 'hospital'],
  ),
  financial: sectorChunks(
    'financial',
    'Financial sector resilience',
    'Banks and insurers align to MAS TRM, fraud monitoring, and third-party risk. CSI cyber range and Elevate programmes support red-team readiness and SOC upskilling.',
    ['mas', 'bank', 'fraud'],
  ),
  government: sectorChunks(
    'government',
    'Public sector programmes',
    'Government agencies adopt IM8 controls, GCC hosting patterns, and whole-of-government training via SkillsFuture Queen Bee networks including Singtel CSI.',
    ['government', 'im8', 'gcc'],
  ),
  sme: sectorChunks(
    'sme',
    'SME cyber uplift',
    'SMEs benefit from packaged Elevate offerings, managed detection, and affordable awareness training funded through SkillsFuture where eligible.',
    ['sme', 'small', 'business'],
  ),
  manufacturing: sectorChunks(
    'manufacturing',
    'Manufacturing OT security',
    'Manufacturers secure PLCs, SCADA, and supply-chain interfaces. Singtel provides OT/IoT assessments, segmentation guidance, and engineer-focused CSI labs.',
    ['manufacturing', 'ot', 'scada'],
  ),
  retail: sectorChunks(
    'retail',
    'Retail & e-commerce',
    'Retailers protect POS, loyalty data, and peak-traffic e-commerce stacks. CSI covers phishing simulations, fraud analytics partners, and PCI-aligned controls.',
    ['retail', 'pci', 'ecommerce'],
  ),
};
