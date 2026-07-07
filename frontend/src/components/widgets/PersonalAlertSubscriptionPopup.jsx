/* ── Personal Alert Subscription floating widget ────────────────────────── */

import { useState } from 'react'
import { Bell, BellRing, CheckCircle } from 'lucide-react'
import { safeLocalStorage } from '../../lib/api'

export default function PersonalAlertSubscriptionPopup({
    state,
    profile,
    onChangeProfile,
    selectedWard,
    lang,
    isOpen,
    onToggle,
    onLoadAdvisory
}) {
    const [personalProfile, setPersonalProfile] = useState(profile || 'healthy_adult')
    const [emailAddress, setEmailAddress] = useState('')
    const [subscriptionActive, setSubscriptionActive] = useState(false)
    const [subscribing, setSubscribing] = useState(false)
    // Lazy initializer reads localStorage once, avoiding a setState-in-effect
    const [recentEmails, setRecentEmails] = useState(() => {
        try {
            const saved = safeLocalStorage.getItem('aqify_subscribed_emails')
            return saved ? JSON.parse(saved) : []
        } catch {
            return []
        }
    })

    // Sync with parent profile if it changes externally (render-phase sync,
    // recommended React pattern instead of setState inside an effect)
    const [prevProfile, setPrevProfile] = useState(profile)
    if (profile !== prevProfile) {
        setPrevProfile(profile)
        if (profile) setPersonalProfile(profile)
    }

    if (!state) return null

    const handleSubscribe = async () => {
        if (!selectedWard || !emailAddress) return;
        setSubscribing(true);
        try {
            const response = await fetch(`/api/advisory/subscribe?ward_id=${selectedWard.id}&profile=${personalProfile}&email=${encodeURIComponent(emailAddress)}`, {
                method: 'POST'
            });
            const data = await response.json();
            if (data.status === 'success') {
                setSubscriptionActive(true);
                onChangeProfile(personalProfile);

                // Update recently subscribed emails
                const updatedList = [emailAddress, ...recentEmails.filter(e => e !== emailAddress)].slice(0, 5)
                setRecentEmails(updatedList)
                safeLocalStorage.setItem('aqify_subscribed_emails', JSON.stringify(updatedList))

                await onLoadAdvisory(selectedWard.id, lang, personalProfile);
                // Auto-reset after 4 seconds so user can subscribe another email
                setTimeout(() => {
                    setSubscriptionActive(false);
                    setEmailAddress('');
                }, 4000);
            }
        } catch (err) {
            console.error("Subscription failed:", err);
        } finally {
            setSubscribing(false);
        }
    }

    return (
        <div className="alert-subscription-widget-container">
            {/* Floating Trigger Button */}
            <button
                className={`alert-trigger-btn ${isOpen ? 'open' : ''}`}
                onClick={onToggle}
                title="Personal Alert Subscription"
            >
                {isOpen ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                ) : (
                    <Bell size={22} />
                )}
            </button>

            {/* Floating Popup Card */}
            {isOpen && (
                <div className="advisory-popup-card" style={{ background: '#f0f7ff', border: '1.5px solid #bfdbfe', boxShadow: '0 10px 40px rgba(59, 130, 246, 0.08)' }}>
                    <div className="advisory-popup-header">
                        <div>
                            <div className="advisory-popup-title">
                                <Bell size={18} color="#3b82f6" />
                                <span style={{ fontSize: '16px', color: '#1e3a8a' }}>Personal Alert Subscription</span>
                            </div>
                            <div className="advisory-popup-subtitle" style={{ fontSize: '12px', color: '#3b82f6' }}>
                                Subscribe to custom air quality alerts
                            </div>
                        </div>
                        <button className="advisory-close-btn" style={{ color: '#3b82f6' }} onClick={onToggle}>&times;</button>
                    </div>

                    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {selectedWard ? (
                            <>
                                <div style={{ fontSize: '14px', fontWeight: '600', color: '#475569' }}>
                                    Ward: <span style={{ color: '#0f172a', fontWeight: '700' }}>{selectedWard.name}</span>
                                </div>

                                <div>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '4px' }}>Profile</label>
                                    <select
                                        className="select-field"
                                        style={{ width: '100%', padding: '8px 12px', fontSize: '14px' }}
                                        value={personalProfile}
                                        onChange={e => {
                                            setPersonalProfile(e.target.value);
                                            setSubscriptionActive(false);
                                        }}
                                    >
                                        <option value="healthy_adult">Healthy Adult</option>
                                        <option value="sensitive">Child / Sensitive Group</option>
                                        <option value="elderly">Elderly (60+)</option>
                                        <option value="outdoor_worker">Outdoor Worker</option>
                                        <option value="asthma">Respiratory / Asthma Condition</option>
                                    </select>
                                </div>

                                <div style={{ animation: 'fadeIn 0.2s ease-in-out' }}>
                                    <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '4px' }}>Email Address</label>
                                    <input
                                        type="email"
                                        className="input-field"
                                        placeholder="e.g. citizen@example.com"
                                        style={{ width: '100%', padding: '8px 12px', fontSize: '14px', boxSizing: 'border-box' }}
                                        value={emailAddress}
                                        onChange={e => {
                                            setEmailAddress(e.target.value);
                                            setSubscriptionActive(false);
                                        }}
                                    />

                                    {/* Subscribed Email Recommendations */}
                                    {recentEmails.length > 0 && (
                                        <div style={{ marginTop: '8px', animation: 'fadeIn 0.2s ease-in-out' }}>
                                            <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                                                Recently Subscribed:
                                            </span>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                {recentEmails.map(email => (
                                                    <button
                                                        key={email}
                                                        type="button"
                                                        onClick={() => {
                                                            setEmailAddress(email);
                                                            setSubscriptionActive(false);
                                                        }}
                                                        style={{
                                                            fontSize: '11px',
                                                            fontWeight: '600',
                                                            color: '#2563eb',
                                                            background: '#eff6ff',
                                                            border: '1px solid #bfdbfe',
                                                            borderRadius: '12px',
                                                            padding: '3px 8px',
                                                            cursor: 'pointer',
                                                            transition: 'all 0.15s ease',
                                                            outline: 'none'
                                                        }}
                                                        onMouseOver={e => {
                                                            e.currentTarget.style.background = '#dbeafe';
                                                            e.currentTarget.style.borderColor = '#3b82f6';
                                                        }}
                                                        onMouseOut={e => {
                                                            e.currentTarget.style.background = '#eff6ff';
                                                            e.currentTarget.style.borderColor = '#bfdbfe';
                                                        }}
                                                    >
                                                        {email}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <button
                                    className="btn btn-primary"
                                    style={{
                                        width: '100%',
                                        background: subscriptionActive ? '#10b981' : '#3b82f6',
                                        color: '#ffffff',
                                        border: 'none',
                                        padding: '10px',
                                        borderRadius: '8px',
                                        fontWeight: '700',
                                        fontSize: '14px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '6px',
                                        marginTop: '8px',
                                        transition: 'all 0.2s'
                                    }}
                                    onClick={handleSubscribe}
                                    disabled={subscribing}
                                >
                                    {subscribing ? (
                                        <span>Applying...</span>
                                    ) : subscriptionActive ? (
                                        <>
                                            <CheckCircle size={14} />
                                            <span>Profile Advisory Applied</span>
                                        </>
                                    ) : (
                                        <>
                                            <BellRing size={14} />
                                            <span>Apply & Subscribe</span>
                                        </>
                                    )}
                                </button>

                                {subscriptionActive && (
                                    <div style={{
                                        padding: '10px 12px',
                                        background: 'rgba(16,185,129,0.06)',
                                        border: '1px solid rgba(16,185,129,0.25)',
                                        borderRadius: '6px',
                                        color: '#047857',
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '6px',
                                        marginTop: '4px',
                                        lineHeight: '1.4',
                                        animation: 'fadeIn 0.2s ease-in-out'
                                    }}>
                                        <CheckCircle size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
                                        <span>
                                            Verification email sent! Check your inbox to confirm subscription.
                                        </span>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '16px', color: '#64748b', fontSize: '13px' }}>
                                Please select a ward on the dashboard to subscribe.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}