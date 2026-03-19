import { useState, useCallback } from "react";
import "../styles/support-widget.css";

export default function SupportWidget({ defaultOpen = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const toggleWidget = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  return (
    <>
      {/* Support Panel */}
      <div className={`support-widget-panel ${isOpen ? "support-widget-panel--open" : ""}`}>
        <div className="support-widget-panel__header">
          <span className="support-widget-panel__title">💬 Need Help?</span>
          <button
            className="support-widget-panel__close"
            onClick={toggleWidget}
            aria-label="Close support panel"
          >
            ✕
          </button>
        </div>

        <div className="support-widget-panel__body">
          <p className="support-widget-panel__greeting">
            Hi there! 👋 We're here to help you get the most out of <strong>CopySpark</strong>.
          </p>

          <div className="support-widget-panel__links">
            <a
              href="mailto:jigneshdhandhukiya63@gmail.com"
              className="support-widget-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="support-widget-link__icon">📧</span>
              <div>
                <strong>Email Support</strong>
                <span>jigneshdhandhukiya63@gmail.com</span>
              </div>
            </a>

            <a
              href="https://wa.me/919099121097"
              className="support-widget-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="support-widget-link__icon">💬</span>
              <div>
                <strong>WhatsApp Support</strong>
                <span>Chat with us on WhatsApp</span>
              </div>
            </a>
          </div>
        </div>

        <div className="support-widget-panel__footer">
          <span>CopySpark v1.0 · We typically reply within 24h</span>
        </div>
      </div>

      {/* Floating Action Button */}
      <button
        className={`support-widget-fab ${isOpen ? "support-widget-fab--active" : ""}`}
        onClick={toggleWidget}
        aria-label="Toggle support widget"
        title="Get Help"
      >
        <span className="support-widget-fab__icon support-widget-fab__icon--chat">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2ZM20 16H5.17L4 17.17V4H20V16Z" fill="white"/>
            <path d="M7 9H17V11H7V9ZM7 6H17V8H7V6ZM7 12H14V14H7V12Z" fill="white"/>
          </svg>
        </span>
        <span className="support-widget-fab__icon support-widget-fab__icon--close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z" fill="white"/>
          </svg>
        </span>
      </button>
    </>
  );
}
