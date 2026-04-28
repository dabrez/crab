/**
 * WhatsApp Business Cloud API payload shapes.
 *
 * Subset covering what we use today; expand on demand.
 * Reference: developers.facebook.com/docs/whatsapp/cloud-api
 */

// ----- Inbound (webhook) -----

export interface InboundEnvelope {
  object: "whatsapp_business_account";
  entry: InboundEntry[];
}

export interface InboundEntry {
  id: string;
  changes: InboundChange[];
}

export interface InboundChange {
  field: "messages";
  value: InboundChangeValue;
}

export interface InboundChangeValue {
  messaging_product: "whatsapp";
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: Array<{ profile: { name?: string }; wa_id: string }>;
  messages?: InboundMessage[];
  statuses?: InboundStatus[];
  errors?: Array<{ code: number; title: string; message?: string }>;
}

export interface InboundMessageBase {
  id: string;
  from: string; // wa_id
  timestamp: string; // unix seconds, as string
  context?: { from: string; id: string };
}

export type InboundMessage = InboundMessageBase &
  (
    | { type: "text"; text: { body: string } }
    | { type: "image"; image: { id: string; mime_type?: string; caption?: string; sha256?: string } }
    | { type: "audio"; audio: { id: string; mime_type?: string } }
    | { type: "document"; document: { id: string; mime_type?: string; filename?: string } }
    | {
        type: "interactive";
        interactive:
          | { type: "button_reply"; button_reply: { id: string; title: string } }
          | { type: "list_reply"; list_reply: { id: string; title: string; description?: string } };
      }
    | { type: "system"; system: { body: string } }
  );

export interface InboundStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title: string; message?: string }>;
}

// ----- Outbound -----

export type OutboundRequest =
  | OutboundText
  | OutboundTemplate
  | OutboundInteractiveButtons
  | OutboundInteractiveList
  | OutboundImage
  | OutboundReaction
  | OutboundReadMarker;

interface OutboundBase {
  messaging_product: "whatsapp";
  recipient_type?: "individual";
  to: string;
}

export interface OutboundText extends OutboundBase {
  type: "text";
  text: { body: string; preview_url?: boolean };
}

export interface OutboundTemplate extends OutboundBase {
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components?: unknown[];
  };
}

export interface OutboundInteractiveButtons extends OutboundBase {
  type: "interactive";
  interactive: {
    type: "button";
    header?: { type: "text"; text: string };
    body: { text: string };
    footer?: { text: string };
    action: {
      buttons: Array<{ type: "reply"; reply: { id: string; title: string } }>;
    };
  };
}

export interface OutboundInteractiveList extends OutboundBase {
  type: "interactive";
  interactive: {
    type: "list";
    header?: { type: "text"; text: string };
    body: { text: string };
    footer?: { text: string };
    action: {
      button: string;
      sections: Array<{
        title?: string;
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
    };
  };
}

export interface OutboundImage extends OutboundBase {
  type: "image";
  image: { link: string; caption?: string };
}

export interface OutboundReaction extends OutboundBase {
  type: "reaction";
  reaction: { message_id: string; emoji: string };
}

export interface OutboundReadMarker {
  messaging_product: "whatsapp";
  status: "read";
  message_id: string;
}

export interface SendResponse {
  messaging_product: "whatsapp";
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}
