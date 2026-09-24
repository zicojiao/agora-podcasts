import posthog from 'posthog-js';
import { sanitizeAnalyticsCapture } from '@/lib/analytics-privacy';

export const ANALYTICS_EVENTS = {
  episodeGenerationStarted: 'episode_generation_started',
  inviteLinkCopied: 'invite_link_copied',
  questionSubmitted: 'question_submitted',
  roomCreated: 'room_created',
  roomJoined: 'room_joined',
  roomLeft: 'room_left',
  takeFloorRequested: 'take_floor_requested',
} as const;

type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
type SafeProperty = string | number | boolean;

let initialized = false;

export function initAnalytics() {
  if (initialized || typeof window === 'undefined') return;

  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!token) return;

  posthog.init(token, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
    defaults: '2026-05-30',
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: false,
    capture_performance: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_web_experiments: true,
    advanced_disable_flags: true,
    person_profiles: 'never',
    persistence: 'localStorage',
    cross_subdomain_cookie: false,
    respect_dnt: true,
    save_referrer: false,
    save_campaign_params: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    before_send: sanitizeAnalyticsCapture,
  });

  initialized = true;
  posthog.capture('$pageview', {
    $current_url: `${window.location.origin}${window.location.pathname}`,
    $pathname: window.location.pathname,
  });
}

export function captureProductEvent(
  event: AnalyticsEvent,
  properties: Record<string, SafeProperty> = {},
) {
  initAnalytics();
  if (!initialized) return;
  posthog.capture(event, properties);
}
