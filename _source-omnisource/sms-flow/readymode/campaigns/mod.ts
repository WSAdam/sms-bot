import { DialerDomain } from "@sms-flow/readymode/dto/mod.ts";

export interface CampaignConfig {
  id: string; // The channel ID (Hash) for injection
  domain: DialerDomain;
  name: string;
  recycleTarget?: string; // Where to move leads after scrubbing
  aggregateGroup?: string; // For grouping stats
  table?: string; // QuickBase Table ID
  report?: string; // QuickBase Report ID
}

export const CAMPAIGN_MASTER_MAP: Record<string, CampaignConfig> = {
  // ===========================================================================
  // ODR (Appointments / Inbound / Forms)
  // ===========================================================================

  "ODR - Appointments": {
    id: "cuCyA6Xoeu88",
    domain: DialerDomain.ODR,
    name: "ODR - Appointments",
    recycleTarget: "",
  },
  "ODR Website Form 1": {
    id: "ptYty8n2dms2",
    domain: DialerDomain.ODR,
    name: "ODR Website Form 1",
    recycleTarget: "",
  },
  "BKS": {
    id: "wCoocn6CrCZc",
    domain: DialerDomain.ODR,
    name: "BKS",
  },
  "ODR Fulfillment": {
    id: "AXeayez7wouY",
    domain: DialerDomain.ODR,
    name: "ODR Fulfillment",
  },

  // --- BKS ODR Group ---
  "BKS ODR 1": {
    id: "sccCa6wAkgYe",
    domain: DialerDomain.ODR,
    name: "BKS ODR 1",
    aggregateGroup: "BKS ODR",
  },
  "BKS ODR 2": {
    id: "hpCZCskrtr",
    domain: DialerDomain.ODR,
    name: "BKS ODR 2",
    aggregateGroup: "BKS ODR",
  },
  "BKS ODR 3": {
    id: "5umqv8dqq2rx",
    domain: DialerDomain.ODR,
    name: "BKS ODR 3",
    aggregateGroup: "BKS ODR",
  },
  "BKS ODR 4": {
    id: "7hdmezC7645e",
    domain: DialerDomain.ODR,
    name: "BKS ODR 4",
    aggregateGroup: "BKS ODR",
  },
  "BKS ODR 5": {
    id: "fscdd62g7y4z",
    domain: DialerDomain.ODR,
    name: "BKS ODR 5",
    aggregateGroup: "BKS ODR",
  },
  "BKS ODR 6": {
    id: "kBbCw3auk",
    domain: DialerDomain.ODR,
    name: "BKS ODR 6",
    aggregateGroup: "BKS ODR",
  },
  "BKS ODR 7": {
    id: "5dvb4gpZw4v7",
    domain: DialerDomain.ODR,
    name: "BKS ODR 7",
    aggregateGroup: "BKS ODR",
  },
  "BKS ODR 8": {
    id: "CuYyrbafvwZa",
    domain: DialerDomain.ODR,
    name: "BKS ODR 8",
    aggregateGroup: "BKS ODR",
  },

  // --- 2ND East Group ---
  "2ND East 1": {
    id: "ypwv7nBmk4Yu",
    domain: DialerDomain.ODR,
    name: "2ND East 1",
    aggregateGroup: "2ND East",
  },
  "2ND East 2": {
    id: "b55oz2r8b",
    domain: DialerDomain.ODR,
    name: "2ND East 2",
    aggregateGroup: "2ND East",
  },
  "2ND East 3": {
    id: "BzyuYmd2r4tq",
    domain: DialerDomain.ODR,
    name: "2ND East 3",
    aggregateGroup: "2ND East",
  },
  "2ND East 4": {
    id: "4bCkzyqnAq",
    domain: DialerDomain.ODR,
    name: "2ND East 4",
    aggregateGroup: "2ND East",
  },
  "2ND East 5": {
    id: "oan4Cdnjbo7u",
    domain: DialerDomain.ODR,
    name: "2ND East 5",
    aggregateGroup: "2ND East",
  },
  "2ND East 6": {
    id: "tYZatary",
    domain: DialerDomain.ODR,
    name: "2ND East 6",
    aggregateGroup: "2ND East",
  },
  "2ND East 7": {
    id: "6zcXn7xprZ2m",
    domain: DialerDomain.ODR,
    name: "2ND East 7",
    aggregateGroup: "2ND East",
  },
  "2ND East 8": {
    id: "xfk6Cewhz9Xa",
    domain: DialerDomain.ODR,
    name: "2ND East 8",
    aggregateGroup: "2ND East",
  },

  // --- 2nd Mid Group ---
  "2nd Mid 1": {
    id: "8n4w6vm3m2dq",
    domain: DialerDomain.ODR,
    name: "2nd Mid 1",
    aggregateGroup: "2nd Mid",
  },
  "2nd Mid 2": {
    id: "jdcvkZkfbhCx",
    domain: DialerDomain.ODR,
    name: "2nd Mid 2",
    aggregateGroup: "2nd Mid",
  },
  "2nd Mid 3": {
    id: "cYm9qqxpApnA",
    domain: DialerDomain.ODR,
    name: "2nd Mid 3",
    aggregateGroup: "2nd Mid",
  },
  "2nd Mid 4": {
    id: "cqqY7zB9b5b6",
    domain: DialerDomain.ODR,
    name: "2nd Mid 4",
    aggregateGroup: "2nd Mid",
  },
  "2nd Mid 5": {
    id: "wXxZbe4ma4Zn",
    domain: DialerDomain.ODR,
    name: "2nd Mid 5",
    aggregateGroup: "2nd Mid",
  },
  "2nd Mid 6": {
    id: "e2Csy2vd",
    domain: DialerDomain.ODR,
    name: "2nd Mid 6",
    aggregateGroup: "2nd Mid",
  },
  "2nd Mid 7": {
    id: "u6atZeXZnjz2",
    domain: DialerDomain.ODR,
    name: "2nd Mid 7",
    aggregateGroup: "2nd Mid",
  },
  "2nd Mid 8": {
    id: "39kr3Bvgjkav",
    domain: DialerDomain.ODR,
    name: "2nd Mid 8",
    aggregateGroup: "2nd Mid",
  },

  // --- 2nd West Group ---
  "2nd West 1": {
    id: "b3aYnfAnhtge",
    domain: DialerDomain.ODR,
    name: "2nd West 1",
    aggregateGroup: "2nd West",
  },
  "2nd West 2": {
    id: "wgdYhbg7bg3d",
    domain: DialerDomain.ODR,
    name: "2nd West 2",
    aggregateGroup: "2nd West",
  },
  "2nd West 3": {
    id: "ysogp96eyuz",
    domain: DialerDomain.ODR,
    name: "2nd West 3",
    aggregateGroup: "2nd West",
  },
  "2nd West 4": {
    id: "brkeAYyr3rtp",
    domain: DialerDomain.ODR,
    name: "2nd West 4",
    aggregateGroup: "2nd West",
  },
  "2nd West 5": {
    id: "zqBYx53zb5mv",
    domain: DialerDomain.ODR,
    name: "2nd West 5",
    aggregateGroup: "2nd West",
  },
  "2nd West 6": {
    id: "zrvngagv6Ba3",
    domain: DialerDomain.ODR,
    name: "2nd West 6",
    aggregateGroup: "2nd West",
  },
  "2nd West 7": {
    id: "yaz455oqry3a",
    domain: DialerDomain.ODR,
    name: "2nd West 7",
    aggregateGroup: "2nd West",
  },
  "2nd West 8": {
    id: "2kcecnsud6oy",
    domain: DialerDomain.ODR,
    name: "2nd West 8",
    aggregateGroup: "2nd West",
  },

  // ===========================================================================
  // MONSTER ACT (Activation Campaigns)
  // ===========================================================================

  "Campaign 1": {
    id: "s2fyaY95pAC2",
    domain: DialerDomain.ACT,
    name: "Act Mid 1",
    table: "bttffb64u",
    report: "370",
  },
  "Act Mid 1": {
    id: "s2fyaY95pAC2",
    domain: DialerDomain.ACT,
    name: "Act Mid 1",
    table: "bttffb64u",
    report: "370",
  },
  "Act Mid 1-b": {
    id: "s2fyaY95pAC2",
    domain: DialerDomain.ACT,
    name: "Act Mid 1-b",
    table: "bttffb64u",
    report: "382",
  },
  "Act Mid 2": {
    id: "wCoocn6CrCZc",
    domain: DialerDomain.ACT,
    name: "Act Mid 2",
    table: "bttffb64u",
    report: "371",
  },
  "Act Mid 2-b": {
    id: "wCoocn6CrCZc",
    domain: DialerDomain.ACT,
    name: "Act Mid 2-b",
    table: "bttffb64u",
    report: "383",
  },
  "Act Mid 3": {
    id: "B9Cn96YCCqf3",
    domain: DialerDomain.ACT,
    name: "Act Mid 3",
    table: "bttffb64u",
    report: "372",
  },
  "Act Mid 3-b": {
    id: "B9Cn96YCCqf3",
    domain: DialerDomain.ACT,
    name: "Act Mid 3-b",
    table: "bttffb64u",
    report: "384",
  },
  "Act Mid 4": {
    id: "Caurc2eb7rnA",
    domain: DialerDomain.ACT,
    name: "Act Mid 4",
    table: "bttffb64u",
    report: "373",
  },
  "Act Mid 4-b": {
    id: "Caurc2eb7rnA",
    domain: DialerDomain.ACT,
    name: "Act Mid 4-b",
    table: "bttffb64u",
    report: "385",
  },

  "Act NE 1": {
    id: "ptYty8n2dms2",
    domain: DialerDomain.ACT,
    name: "Act NE 1",
    table: "bttffb64u",
    report: "357",
  },
  "Act NE 1-b": {
    id: "ptYty8n2dms2",
    domain: DialerDomain.ACT,
    name: "Act NE 1-b",
    table: "bttffb64u",
    report: "374",
  },
  "Act NE 2": {
    id: "AXeayez7wouY",
    domain: DialerDomain.ACT,
    name: "Act NE 2",
    table: "bttffb64u",
    report: "359",
  },
  "Act NE 2-b": {
    id: "AXeayez7wouY",
    domain: DialerDomain.ACT,
    name: "Act NE 2-b",
    table: "bttffb64u",
    report: "375",
  },
  "Act NE 3": {
    id: "kuBv527fc8Cu",
    domain: DialerDomain.ACT,
    name: "Act NE 3",
    table: "bttffb64u",
    report: "360",
  },
  "Act NE 3-b": {
    id: "kuBv527fc8Cu",
    domain: DialerDomain.ACT,
    name: "Act NE 3-b",
    table: "bttffb64u",
    report: "376",
  },
  "Act NE 4": {
    id: "ZybZ7am4",
    domain: DialerDomain.ACT,
    name: "Act NE 4",
    table: "bttffb64u",
    report: "361",
  },
  "Act NE 4-b": {
    id: "ZybZ7am4",
    domain: DialerDomain.ACT,
    name: "Act NE 4-b",
    table: "bttffb64u",
    report: "377",
  },

  "Act West 1": {
    id: "6ZbnppyY9otm",
    domain: DialerDomain.ACT,
    name: "Act West 1",
    table: "bttffb64u",
    report: "362",
  },
  "Act West 1-b": {
    id: "6ZbnppyY9otm",
    domain: DialerDomain.ACT,
    name: "Act West 1-b",
    table: "bttffb64u",
    report: "386",
  },
  "Act West 2": {
    id: "pcAC4g8443wd",
    domain: DialerDomain.ACT,
    name: "Act West 2",
    table: "bttffb64u",
    report: "363",
  },
  "Act West 2-b": {
    id: "pcAC4g8443wd",
    domain: DialerDomain.ACT,
    name: "Act West 2-b",
    table: "bttffb64u",
    report: "387",
  },
  "Act West 3": {
    id: "agbpfgrwgeCk",
    domain: DialerDomain.ACT,
    name: "Act West 3",
    table: "bttffb64u",
    report: "365",
  },
  "Act West 3-b": {
    id: "agbpfgrwgeCk",
    domain: DialerDomain.ACT,
    name: "Act West 3-b",
    table: "bttffb64u",
    report: "388",
  },
  "Act West 4": {
    id: "3u9YoC4zt3fc",
    domain: DialerDomain.ACT,
    name: "Act West 4",
    table: "bttffb64u",
    report: "364",
  },
  "Act West 4-b": {
    id: "3u9YoC4zt3fc",
    domain: DialerDomain.ACT,
    name: "Act West 4-b",
    table: "bttffb64u",
    report: "389",
  },

  "Act SE 1": {
    id: "6Yhg3qYm33oz",
    domain: DialerDomain.ACT,
    name: "Act SE 1",
    table: "bttffb64u",
    report: "366",
  },
  "Act SE 1-b": {
    id: "6Yhg3qYm33oz",
    domain: DialerDomain.ACT,
    name: "Act SE 1-b",
    table: "bttffb64u",
    report: "378",
  },
  "Act SE 2": {
    id: "kCcsrZh75yjq",
    domain: DialerDomain.ACT,
    name: "Act SE 2",
    table: "bttffb64u",
    report: "367",
  },
  "Act SE 2-b": {
    id: "kCcsrZh75yjq",
    domain: DialerDomain.ACT,
    name: "Act SE 2-b",
    table: "bttffb64u",
    report: "379",
  },
  "Act SE 3": {
    id: "ZCCvm7986ray",
    domain: DialerDomain.ACT,
    name: "Act SE 3",
    table: "bttffb64u",
    report: "368",
  },
  "Act SE 3-b": {
    id: "ZCCvm7986ray",
    domain: DialerDomain.ACT,
    name: "Act SE 3-b",
    table: "bttffb64u",
    report: "380",
  },
  "Act SE 4": {
    id: "nbqAbm7o3ntA",
    domain: DialerDomain.ACT,
    name: "Act SE 4",
    table: "bttffb64u",
    report: "369",
  },
  "Act SE 4-b": {
    id: "nbqAbm7o3ntA",
    domain: DialerDomain.ACT,
    name: "Act SE 4-b",
    table: "bttffb64u",
    report: "381",
  },

  "Act OPS": { id: "qBt8d946b3de", domain: DialerDomain.ACT, name: "Act OPS" },

  // ===========================================================================
  // MONSTER DS (Data Source / Discovery)
  // ===========================================================================

  "DS Mid 1": {
    id: "u2mro97Bgbs4",
    domain: DialerDomain.DS,
    name: "DS Mid 1",
    table: "bpb28qsnn",
    report: "921",
  },
  "DS Mid 2": {
    id: "qyCq7ncqBy7t",
    domain: DialerDomain.DS,
    name: "DS Mid 2",
    table: "bpb28qsnn",
    report: "922",
  },
  "DS Mid 3": {
    id: "BkeBaZpBvov4",
    domain: DialerDomain.DS,
    name: "DS Mid 3",
    table: "bpb28qsnn",
    report: "923",
  },
  "DS Mid 4": {
    id: "yvn64Bto4bnt",
    domain: DialerDomain.DS,
    name: "DS Mid 4",
    table: "bpb28qsnn",
    report: "924",
  },

  "DS NorthEast 1": {
    id: "3yXBC3nbuhnr",
    domain: DialerDomain.DS,
    name: "DS NorthEast 1",
    table: "bpb28qsnn",
    report: "913",
  },
  "DS NorthEast 2": {
    id: "Bmgx3tX8ejzc",
    domain: DialerDomain.DS,
    name: "DS NorthEast 2",
    table: "bpb28qsnn",
    report: "914",
  },
  "DS NorthEast 3": {
    id: "k8egBykqjdqy",
    domain: DialerDomain.DS,
    name: "DS NorthEast 3",
    table: "bpb28qsnn",
    report: "915",
  },
  "DS NorthEast 4": {
    id: "oeerh2j5ygBs",
    domain: DialerDomain.DS,
    name: "DS NorthEast 4",
    table: "bpb28qsnn",
    report: "916",
  },

  "DS NorthWest 1": {
    id: "C55Bax8XZtBs",
    domain: DialerDomain.DS,
    name: "DS NorthWest 1",
    table: "bpb28qsnn",
    report: "909",
  },
  "DS NorthWest 2": {
    id: "779YB8p2",
    domain: DialerDomain.DS,
    name: "DS NorthWest 2",
    table: "bpb28qsnn",
    report: "910",
  },
  "DS NorthWest 3": {
    id: "uamv8u26",
    domain: DialerDomain.DS,
    name: "DS NorthWest 3",
    table: "bpb28qsnn",
    report: "911",
  },
  "DS NorthWest 4": {
    id: "sx2CqXou5zuz",
    domain: DialerDomain.DS,
    name: "DS NorthWest 4",
    table: "bpb28qsnn",
    report: "912",
  },

  "DS SouthEast 1": {
    id: "whzZhrqq7vp5",
    domain: DialerDomain.DS,
    name: "DS SouthEast 1",
    table: "bpb28qsnn",
    report: "917",
  },
  "DS SouthEast 2": {
    id: "ayZ77ft8px3C",
    domain: DialerDomain.DS,
    name: "DS SouthEast 2",
    table: "bpb28qsnn",
    report: "918",
  },
  "DS SouthEast 3": {
    id: "cd2tzs4tmgav",
    domain: DialerDomain.DS,
    name: "DS SouthEast 3",
    table: "bpb28qsnn",
    report: "919",
  },
  "DS SouthEast 4": {
    id: "fdchzXvu3r9s",
    domain: DialerDomain.DS,
    name: "DS SouthEast 4",
    table: "bpb28qsnn",
    report: "920",
  },

  "DS SouthWest 1": {
    id: "Ccw4ysnm8wp3",
    domain: DialerDomain.DS,
    name: "DS SouthWest 1",
    table: "bpb28qsnn",
    report: "905",
  },
  "DS SouthWest 2": {
    id: "ycY97Xpn9n8m",
    domain: DialerDomain.DS,
    name: "DS SouthWest 2",
    table: "bpb28qsnn",
    report: "906",
  },
  "DS SouthWest 3": {
    id: "m7dftXrzaZ56",
    domain: DialerDomain.DS,
    name: "DS SouthWest 3",
    table: "bpb28qsnn",
    report: "907",
  },
  "DS SouthWest 4": {
    id: "uxqqnkf6at4h",
    domain: DialerDomain.DS,
    name: "DS SouthWest 4",
    table: "bpb28qsnn",
    report: "908",
  },
};

export function getCampaignConfig(name: string): CampaignConfig | undefined {
  return CAMPAIGN_MASTER_MAP[name];
}
