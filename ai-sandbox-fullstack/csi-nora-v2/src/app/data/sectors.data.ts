import { Sector } from '../models';

export const SECTORS: Record<string, Sector> = {
  healthcare: {
    name: 'Healthcare', icon: '🏥', count: 8,
    desc: 'Cybersecurity, connectivity & AI for hospitals, clinics & health systems.',
    services: [
      { tag: 'MDR/SOC', color: '#E0001A', bg: 'rgba(224,0,26,0.12)' },
      { tag: 'IoMT Security', color: '#A855F7', bg: 'rgba(168,85,247,0.12)' },
      { tag: 'HIPAA/PDPA', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
      { tag: 'Secure SD-WAN', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
      { tag: 'Cloud Security', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
    ],
    quickPrompts: ['What MDR solutions fit healthcare?', 'How does IoMT security work?', 'PDPA compliance for hospitals', '5G connectivity for clinics'],
    context: `You are Nora, Singtel CSI advisor for HEALTHCARE. Services: MDR/SOC 24x7, IoMT security, SD-WAN, PDPA/HIPAA compliance, EHR security, cloud security, DLP for patient data, IR/forensics. Focus: patient data protection, medical device vulns, MOH/PDPA compliance, care continuity.`
  },
  financial: {
    name: 'Financial Services', icon: '🏦', count: 9,
    desc: 'MAS-aligned security, fraud detection & resilience for banks, insurers & fintechs.',
    services: [
      { tag: 'MAS TRM', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
      { tag: 'Fraud Detection', color: '#E0001A', bg: 'rgba(224,0,26,0.12)' },
      { tag: 'SIEM/SOAR', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
      { tag: 'Red Teaming', color: '#A855F7', bg: 'rgba(168,85,247,0.12)' },
      { tag: 'Zero Trust', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
    ],
    quickPrompts: ['MAS TRM compliance', 'Zero trust for banking', 'VAPT for fintech', 'Ransomware resilience'],
    context: `You are Nora, Singtel CSI advisor for FINANCIAL SERVICES. Services: MAS TRM advisory, SIEM/SOAR, VAPT/red team, DDoS protection, zero trust, Swift security, vendor risk management, business continuity. Regulatory: MAS TRM, PDPA, Notice 655.`
  },
  government: {
    name: 'Government & Public', icon: '🏛️', count: 7,
    desc: 'Classified-ready security, GovTech integration & critical infrastructure protection.',
    services: [
      { tag: 'CII Protection', color: '#E0001A', bg: 'rgba(224,0,26,0.12)' },
      { tag: 'GovTech Integration', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
      { tag: 'OT/SCADA', color: '#A855F7', bg: 'rgba(168,85,247,0.12)' },
      { tag: 'SOC-as-a-Service', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
    ],
    quickPrompts: ['CII sector compliance', 'Secure government cloud', 'OT/SCADA for utilities', 'National SOC support'],
    context: `You are Nora, Singtel CSI advisor for GOVERNMENT & PUBLIC SECTOR. Services: CII protection, WOG security ops, private 5G, OT/SCADA security, GCC assessments, classified data handling, threat intel (CSA/CSIT), tabletop exercises. Context: CSA Cybersecurity Act, Smart Nation.`
  },
  retail: {
    name: 'Retail & E-Commerce', icon: '🛒', count: 7,
    desc: 'PCI-DSS compliance, anti-fraud & omnichannel security.',
    services: [
      { tag: 'PCI-DSS', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
      { tag: 'Anti-Fraud', color: '#E0001A', bg: 'rgba(224,0,26,0.12)' },
      { tag: 'WAF/API Security', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
      { tag: 'DDoS Protection', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
    ],
    quickPrompts: ['PCI-DSS for e-commerce', 'Web application firewall', 'Loyalty data protection', 'Peak season DDoS'],
    context: `You are Nora, Singtel CSI advisor for RETAIL & E-COMMERCE. Services: PCI-DSS compliance, WAF/API security, anti-skimming, SD-WAN multi-branch, PDPA compliance, DDoS protection, mobile/QR security.`
  },
  manufacturing: {
    name: 'Manufacturing & OT', icon: '🏭', count: 8,
    desc: 'OT/ICS security, private 5G & Industry 4.0 resilience.',
    services: [
      { tag: 'OT/ICS Security', color: '#E0001A', bg: 'rgba(224,0,26,0.12)' },
      { tag: 'Private 5G', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
      { tag: 'ICS VAPT', color: '#A855F7', bg: 'rgba(168,85,247,0.12)' },
      { tag: 'Asset Visibility', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
    ],
    quickPrompts: ['OT network segmentation', 'Purdue model security', 'ICS vulnerability assessment', 'Private 5G for factory'],
    context: `You are Nora, Singtel CSI advisor for MANUFACTURING & OT. Services: OT/ICS assessments (Purdue Model), asset discovery, OT SIEM (Claroty/Nozomi), private 5G, IT/OT convergence architecture, PLC/SCADA VAPT, OT patch management.`
  },
  logistics: {
    name: 'Logistics & Maritime', icon: '🚢', count: 6,
    desc: 'Port cybersecurity, fleet connectivity & supply chain resilience.',
    services: [
      { tag: 'Port Cybersecurity', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
      { tag: 'Fleet Connectivity', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
      { tag: 'Supply Chain Risk', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
      { tag: 'AIS/GPS Security', color: '#A855F7', bg: 'rgba(168,85,247,0.12)' },
    ],
    quickPrompts: ['Port OT security', 'Supply chain attack vectors', 'Maritime GPS spoofing', 'Cold chain IoT protection'],
    context: `You are Nora, Singtel CSI advisor for LOGISTICS & MARITIME. Services: port terminal OT/ICS, vessel connectivity (VSAT/LTE/5G), AIS/GPS anti-spoofing, cargo system security, supply chain risk, fleet IoT, cold chain monitoring, ISPS Code compliance.`
  },
  telco: {
    name: 'Telco & Media', icon: '📡', count: 7,
    desc: '5G core security, network slicing & broadcast infrastructure resilience.',
    services: [
      { tag: '5G Core Security', color: '#E0001A', bg: 'rgba(224,0,26,0.12)' },
      { tag: 'Network Slicing', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
      { tag: 'SS7/Diameter', color: '#A855F7', bg: 'rgba(168,85,247,0.12)' },
      { tag: 'CDN Security', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
    ],
    quickPrompts: ['5G network slicing security', 'SS7 signalling protection', 'OTT platform security', 'IMDA compliance'],
    context: `You are Nora, Singtel CSI advisor for TELCO & MEDIA. Services: 5G core security, SS7/Diameter/GTP signalling, network slicing isolation, CDN/DDoS, OTT platform security, broadcast infrastructure, IMDA compliance, roaming fraud detection, NFV/SDN security.`
  },
  sme: {
    name: 'SME & Enterprise', icon: '💼', count: 9,
    desc: 'Scalable security, AI adoption & managed services for Singapore SMEs.',
    services: [
      { tag: 'Managed Security', color: '#E0001A', bg: 'rgba(224,0,26,0.12)' },
      { tag: 'AI Adoption', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
      { tag: 'PDPA Compliance', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
      { tag: 'Cyber Essentials', color: '#A855F7', bg: 'rgba(168,85,247,0.12)' },
    ],
    quickPrompts: ['Cyber Essentials for SME', 'AI adoption risks', 'PDPA for SME owners', 'Affordable MDR options'],
    context: `You are Nora, Singtel CSI advisor for SME & ENTERPRISE. Services: CSA Cyber Essentials/Cyber Trust, affordable MDR-Lite, AI adoption risk assessment, PDPA compliance, M365/Workspace security, phishing simulation, BCP planning. Focus: SG Digital grants, AI.dea programme, IMDA Digital Enterprise Blueprint.`
  }
};

export const SECTOR_KEYS = Object.keys(SECTORS);
