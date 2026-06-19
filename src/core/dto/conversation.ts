export interface ConversationMessage {
  phoneNumber: string;
  callId: string;
  timestamp: string;
  sender: "Guest" | "AI Bot";
  message: string;
  nodeTag?: string;
  doNotText?: boolean;
}

export interface CallIdLookup {
  phone: string;
}
