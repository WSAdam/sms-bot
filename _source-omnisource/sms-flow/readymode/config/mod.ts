import { DialerDomain } from "@sms-flow/readymode/dto/mod.ts";

export interface DomainConfig {
  baseUrl: string;
  channels: Record<string, string>;
}

export const DOMAIN_CONFIG: Record<DialerDomain, DomainConfig> = {
  [DialerDomain.MONSTER]: {
    baseUrl: "https://monsterrg.readymode.com",
    channels: { addLead: "lead-api/8qhAtb6vnrxb", scrubLead: "TPI/lead", dnc: "TPI/DNC" },
  },
  [DialerDomain.ODS]: {
    baseUrl: "https://monsterods.readymode.com",
    channels: { addLead: "lead-api/s2fyaY95pAC2", scrubLead: "TPI/lead", dnc: "TPI/DNC" },
  },
  [DialerDomain.ODR]: {
    baseUrl: "https://monsterodr.readymode.com",
    channels: { addLead: "lead-api/wCoocn6CrCZc", scrubLead: "TPI/lead", dnc: "TPI/DNC" },
  },
  [DialerDomain.ACT]: {
    baseUrl: "https://monsteract.readymode.com",
    channels: { addLead: "n/a", scrubLead: "TPI/lead", dnc: "TPI/DNC" },
  },
  [DialerDomain.DS]: {
    baseUrl: "https://monsterrd2.readymode.com",
    channels: { addLead: "n/a", scrubLead: "TPI/lead", dnc: "TPI/DNC" },
  },
};
