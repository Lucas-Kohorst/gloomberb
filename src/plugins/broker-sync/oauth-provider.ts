import {
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { robinhoodClientMetadata } from "../../shared/robinhood-oauth";

export interface RobinhoodOAuthData {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
}

export function cloneRobinhoodOAuth(value: unknown): RobinhoodOAuthData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return structuredClone(value) as RobinhoodOAuthData;
}

export class RobinhoodOAuthProvider implements OAuthClientProvider {
  constructor(
    readonly redirectUrl: string,
    private readonly oauth: RobinhoodOAuthData,
    private readonly oauthState: string,
    private readonly openAuthorizationUrl: (url: URL) => Promise<void>,
  ) {}

  get clientMetadata() {
    return robinhoodClientMetadata(this.redirectUrl);
  }

  state() { return this.oauthState; }
  clientInformation() { return this.oauth.clientInformation; }
  saveClientInformation(value: OAuthClientInformationMixed) { this.oauth.clientInformation = value; }
  tokens() { return this.oauth.tokens; }
  saveTokens(value: OAuthTokens) { this.oauth.tokens = value; }
  async redirectToAuthorization(url: URL) { await this.openAuthorizationUrl(url); }
  saveCodeVerifier(value: string) { this.oauth.codeVerifier = value; }
  codeVerifier() {
    if (!this.oauth.codeVerifier) throw new Error("The Robinhood OAuth verifier is missing.");
    return this.oauth.codeVerifier;
  }
  saveDiscoveryState(value: OAuthDiscoveryState) { this.oauth.discoveryState = value; }
  discoveryState() { return this.oauth.discoveryState; }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "client") delete this.oauth.clientInformation;
    if (scope === "all" || scope === "tokens") delete this.oauth.tokens;
    if (scope === "all" || scope === "verifier") delete this.oauth.codeVerifier;
    if (scope === "all" || scope === "discovery") delete this.oauth.discoveryState;
  }
}

export function randomOAuthState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
