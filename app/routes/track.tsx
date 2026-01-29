import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, useLoaderData } from "@remix-run/react";
import prisma from "../db.server";

// Public page for customers to track their order status
// Accessible without authentication via unique tracking token

interface TrackingEvent {
  date: string;
  status: string;
  location?: string;
  description: string;
}

interface TrackingData {
  orderNumber: string;
  status: string;
  carrier: string | null;
  trackingNumber: string | null;
  estimatedDelivery: string | null;
  events: TrackingEvent[];
  updatedAt: string;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return json({ error: "Tracking token required" }, { status: 400 });
  }

  // Find tracking by token
  const tracking = await prisma.customerTracking.findUnique({
    where: { trackingToken: token },
  });

  if (!tracking) {
    return json({ error: "Tracking not found" }, { status: 404 });
  }

  // Parse events
  let events: TrackingEvent[] = [];
  if (tracking.events) {
    try {
      events = JSON.parse(tracking.events);
    } catch {
      events = [];
    }
  }

  const data: TrackingData = {
    orderNumber: tracking.orderNumber,
    status: tracking.status,
    carrier: tracking.carrier,
    trackingNumber: tracking.trackingNumber,
    estimatedDelivery: tracking.estimatedDelivery?.toISOString() || null,
    events,
    updatedAt: tracking.updatedAt.toISOString(),
  };

  return json({ tracking: data });
};

export default function CustomerTrackingPage() {
  const loaderData = useLoaderData<typeof loader>();

  // Type guard for error response
  if ('error' in loaderData) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.errorIcon}>❌</div>
          <h1 style={styles.errorTitle}>Tracking Not Found</h1>
          <p style={styles.errorText}>{loaderData.error}</p>
        </div>
      </div>
    );
  }

  const { tracking } = loaderData;

  const getStatusStep = (status: string): number => {
    switch (status) {
      case 'processing': return 1;
      case 'shipped': return 2;
      case 'in_transit': return 3;
      case 'delivered': return 4;
      default: return 1;
    }
  };

  const currentStep = getStatusStep(tracking.status);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <h1 style={styles.title}>Order Tracking</h1>
          <p style={styles.orderNumber}>Order #{tracking.orderNumber}</p>
        </div>

        {/* Status Progress */}
        <div style={styles.progressContainer}>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${(currentStep / 4) * 100}%` }} />
          </div>
          <div style={styles.steps}>
            <div style={{ ...styles.step, ...(currentStep >= 1 ? styles.stepActive : {}) }}>
              <div style={styles.stepIcon}>📦</div>
              <span>Processing</span>
            </div>
            <div style={{ ...styles.step, ...(currentStep >= 2 ? styles.stepActive : {}) }}>
              <div style={styles.stepIcon}>🚚</div>
              <span>Shipped</span>
            </div>
            <div style={{ ...styles.step, ...(currentStep >= 3 ? styles.stepActive : {}) }}>
              <div style={styles.stepIcon}>✈️</div>
              <span>In Transit</span>
            </div>
            <div style={{ ...styles.step, ...(currentStep >= 4 ? styles.stepActive : {}) }}>
              <div style={styles.stepIcon}>✅</div>
              <span>Delivered</span>
            </div>
          </div>
        </div>

        {/* Tracking Info */}
        <div style={styles.infoSection}>
          {tracking.carrier && (
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Carrier</span>
              <span style={styles.infoValue}>{tracking.carrier}</span>
            </div>
          )}
          {tracking.trackingNumber && (
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Tracking Number</span>
              <a
                href={getCarrierTrackingUrl(tracking.carrier, tracking.trackingNumber)}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.trackingLink}
              >
                {tracking.trackingNumber}
              </a>
            </div>
          )}
          {tracking.estimatedDelivery && (
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Estimated Delivery</span>
              <span style={styles.infoValue}>
                {new Date(tracking.estimatedDelivery).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </div>
          )}
        </div>

        {/* Events Timeline */}
        {tracking.events && tracking.events.length > 0 && (
          <div style={styles.timeline}>
            <h2 style={styles.timelineTitle}>Tracking History</h2>
            {tracking.events.map((event, idx) => (
              <div key={idx} style={styles.timelineItem}>
                <div style={styles.timelineDot} />
                <div style={styles.timelineContent}>
                  <div style={styles.timelineStatus}>{event.status}</div>
                  <div style={styles.timelineDescription}>{event.description}</div>
                  {event.location && (
                    <div style={styles.timelineLocation}>📍 {event.location}</div>
                  )}
                  <div style={styles.timelineDate}>{formatDate(event.date)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Last Updated */}
        <div style={styles.footer}>
          Last updated: {formatDate(tracking.updatedAt)}
        </div>
      </div>
    </div>
  );
}

function getCarrierTrackingUrl(carrier: string | null, trackingNumber: string): string {
  const trackingNum = encodeURIComponent(trackingNumber);
  switch (carrier?.toLowerCase()) {
    case 'ups':
      return `https://www.ups.com/track?tracknum=${trackingNum}`;
    case 'fedex':
      return `https://www.fedex.com/fedextrack/?trknbr=${trackingNum}`;
    case 'usps':
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNum}`;
    case 'dhl':
      return `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNum}`;
    default:
      return `https://www.google.com/search?q=${trackingNum}`;
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '40px 20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    maxWidth: '600px',
    margin: '0 auto',
    background: 'white',
    borderRadius: '16px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
    overflow: 'hidden',
  },
  header: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '30px',
    textAlign: 'center',
    color: 'white',
  },
  title: {
    margin: 0,
    fontSize: '28px',
    fontWeight: 700,
  },
  orderNumber: {
    margin: '10px 0 0',
    opacity: 0.9,
    fontSize: '16px',
  },
  progressContainer: {
    padding: '30px',
    borderBottom: '1px solid #eee',
  },
  progressBar: {
    height: '8px',
    background: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '20px',
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #667eea, #764ba2)',
    transition: 'width 0.5s ease',
  },
  steps: {
    display: 'flex',
    justifyContent: 'space-between',
  },
  step: {
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: '12px',
  },
  stepActive: {
    color: '#667eea',
    fontWeight: 600,
  },
  stepIcon: {
    fontSize: '24px',
    marginBottom: '8px',
  },
  infoSection: {
    padding: '20px 30px',
    borderBottom: '1px solid #eee',
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '12px 0',
    borderBottom: '1px solid #f3f4f6',
  },
  infoLabel: {
    color: '#6b7280',
    fontSize: '14px',
  },
  infoValue: {
    fontWeight: 600,
    color: '#1f2937',
  },
  trackingLink: {
    color: '#667eea',
    textDecoration: 'none',
    fontWeight: 600,
  },
  timeline: {
    padding: '30px',
  },
  timelineTitle: {
    margin: '0 0 20px',
    fontSize: '18px',
    fontWeight: 600,
  },
  timelineItem: {
    display: 'flex',
    gap: '15px',
    marginBottom: '20px',
    position: 'relative',
  },
  timelineDot: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    background: '#667eea',
    flexShrink: 0,
    marginTop: '4px',
  },
  timelineContent: {
    flex: 1,
  },
  timelineStatus: {
    fontWeight: 600,
    color: '#1f2937',
    marginBottom: '4px',
  },
  timelineDescription: {
    color: '#6b7280',
    fontSize: '14px',
  },
  timelineLocation: {
    color: '#9ca3af',
    fontSize: '13px',
    marginTop: '4px',
  },
  timelineDate: {
    color: '#9ca3af',
    fontSize: '12px',
    marginTop: '4px',
  },
  footer: {
    padding: '20px 30px',
    background: '#f9fafb',
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: '13px',
  },
  errorIcon: {
    fontSize: '64px',
    textAlign: 'center',
    marginBottom: '20px',
  },
  errorTitle: {
    margin: 0,
    textAlign: 'center',
    color: '#1f2937',
  },
  errorText: {
    textAlign: 'center',
    color: '#6b7280',
    marginTop: '10px',
  },
};
