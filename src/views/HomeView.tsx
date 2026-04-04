type HomeViewProps = {
  email?: string;
  onOpenInterviewFloating: () => void;
  onOpenAssistantFull: () => void;
};

export function HomeView({ email, onOpenInterviewFloating, onOpenAssistantFull }: HomeViewProps) {
  return (
    <main className="main main-home">
      <div className="home-welcome">
        <h1 className="home-title">Welcome</h1>
        {email && <p className="home-subtitle">Signed in as {email}</p>}
      </div>
      <div className="home-sections">
        <button
          type="button"
          className="home-section-card"
          onClick={onOpenInterviewFloating}
          aria-label="Open AI Interview Assistant"
        >
          <span className="home-section-icon" aria-hidden>
            🎤
          </span>
          <h2 className="home-section-title">AI Interview Assistant</h2>
          <p className="home-section-desc">
            Works with Zoom, Meet, Teams – listens to questions, gives you answers to read. Start listening or type a
            question to get AI answers.
          </p>
        </button>
        <button type="button" className="home-section-card" onClick={onOpenAssistantFull} aria-label="Open Project Management Assistant">
          <span className="home-section-icon" aria-hidden>
            📋
          </span>
          <h2 className="home-section-title">Project Management</h2>
          <p className="home-section-desc">
            This AI Assistant helps you deal with clients in meetings. Get real-time suggestions, talking points, and
            answers during Zoom, Meet, or Teams calls so you stay on top of project discussions.
          </p>
        </button>
        <button type="button" className="home-section-card" onClick={onOpenAssistantFull} aria-label="Open Chat with AI">
          <span className="home-section-icon" aria-hidden>
            💬
          </span>
          <h2 className="home-section-title">Chat with AI</h2>
          <p className="home-section-desc">
            Have a natural conversation with AI. Ask questions, get instant answers, and brainstorm ideas through an
            intuitive chat interface.
          </p>
        </button>
        <button
          type="button"
          className="home-section-card"
          onClick={onOpenAssistantFull}
          aria-label="Open Interview Preparation AI BOT"
        >
          <span className="home-section-icon" aria-hidden>
            🎯
          </span>
          <h2 className="home-section-title">Interview Preparation AI BOT</h2>
          <p className="home-section-desc">
            Prepare for your next interview with AI. Practice common questions, get sample answers, and refine your
            responses for technical and behavioral rounds.
          </p>
        </button>
        <button type="button" className="home-section-card" onClick={onOpenAssistantFull} aria-label="Open AI Sales Assistant">
          <span className="home-section-icon" aria-hidden>
            🤝
          </span>
          <h2 className="home-section-title">AI Sales Assistant</h2>
          <p className="home-section-desc">
            Helps you deal with clients in meetings. Get real-time pitch suggestions, objection handling, and talking
            points during sales calls on Zoom, Meet, or Teams.
          </p>
        </button>
        <button type="button" className="home-section-card" onClick={onOpenAssistantFull} aria-label="Open HR Calling Agent">
          <span className="home-section-icon" aria-hidden>
            📞
          </span>
          <h2 className="home-section-title">HR Calling Agent</h2>
          <p className="home-section-desc">
            AI agent that calls interviewees, aligns schedules, and schedules online meetings. The HR BOT conducts the
            interview at the appointed time.
          </p>
        </button>
        <button type="button" className="home-section-card" onClick={onOpenAssistantFull} aria-label="Open Upwork AI Bidder">
          <span className="home-section-icon" aria-hidden>
            📝
          </span>
          <h2 className="home-section-title">Upwork AI Bidder</h2>
          <p className="home-section-desc">
            Hunts jobs on Upwork and creates tailored proposals from the job or project description to pitch to clients
            and win more work.
          </p>
        </button>
      </div>
    </main>
  );
}
