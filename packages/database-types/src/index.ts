export type Json =
  | boolean
  | null
  | number
  | string
  | Json[]
  | { [key: string]: Json | undefined };

export interface Database {
  public: {
    Tables: {
      event_jobs: {
        Row: EventJobRow;
        Insert: Omit<EventJobRow, "created_at" | "id" | "updated_at"> & {
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Update: Partial<EventJobRow>;
        Relationships: [];
      };
      raw_events: {
        Row: RawEventRow;
        Insert: Omit<
          RawEventRow,
          | "created_at"
          | "first_seen_at"
          | "id"
          | "last_seen_at"
          | "revision"
          | "updated_at"
        > & {
          created_at?: string;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          revision?: number;
          updated_at?: string;
        };
        Update: Partial<RawEventRow>;
        Relationships: [];
      };
      source_health: {
        Row: SourceHealthRow;
        Insert: Omit<SourceHealthRow, "id" | "updated_at"> & {
          id?: string;
          updated_at?: string;
        };
        Update: Partial<SourceHealthRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      ingest_raw_event: {
        Args: {
          p_event_type: string;
          p_external_id: string;
          p_fingerprint: string;
          p_payload: Json;
          p_source: string;
          p_source_created_at?: string | null;
          p_source_updated_at?: string | null;
        };
        Returns: {
          changed: boolean;
          job_id: string | null;
          raw_event_id: string;
          revision: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export interface RawEventRow {
  created_at: string;
  event_type: string;
  external_id: string;
  fingerprint: string;
  first_seen_at: string;
  id: string;
  last_seen_at: string;
  payload: Json;
  processing_status: string;
  revision: number;
  security_status: string;
  source: string;
  source_created_at: string | null;
  source_updated_at: string | null;
  updated_at: string;
}

export interface EventJobRow {
  attempts: number;
  completed_at: string | null;
  created_at: string;
  error: string | null;
  id: string;
  job_type: string;
  locked_at: string | null;
  locked_by: string | null;
  raw_event_id: string;
  raw_event_revision: number;
  status: string;
  updated_at: string;
}

export interface SourceHealthRow {
  etag: string | null;
  id: string;
  items_changed: number;
  items_received: number;
  last_error: string | null;
  last_error_at: string | null;
  last_modified: string | null;
  last_poll_at: string | null;
  last_success_at: string | null;
  latency_ms: number | null;
  source: string;
  status: string;
  updated_at: string;
}
