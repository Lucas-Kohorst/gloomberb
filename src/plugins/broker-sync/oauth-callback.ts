export interface OAuthCallback {
  redirectUrl: string;
  code: Promise<string>;
  close(): Promise<void>;
}
