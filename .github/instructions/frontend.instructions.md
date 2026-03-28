---
applyTo: 'packages/client/**'
---

# Frontend (React Client) Development Guide

This file applies specifically to the `packages/client/` directory. Reference the main instructions at [.github/copilot-instructions.md](../copilot-instructions.md) for general monorepo conventions.

## Client Structure

```
packages/client/src/
├── main.tsx               # React entry (mounts to #root)
├── App.tsx                # Router setup + AuthContext wrapper
├── api/
│   └── client.ts          # Typed fetch wrapper (auto-injects JWT, handles .ics)
├── context/
│   └── AuthContext.tsx    # User state, login/logout/register, JWT management
├── components/
│   ├── Layout.tsx         # App shell (sidebar + main, responsive hamburger)
│   ├── CreateProjectModal.tsx
│   └── AddTimeBlockModal.tsx
├── pages/
│   ├── LoginPage.tsx              # /login (guest only)
│   ├── DashboardPage.tsx          # /dashboard, /projects (JWT protected)
│   ├── ProjectDetailPage.tsx      # /projects/:id (JWT protected)
│   ├── PublicBookingPage.tsx      # /schedule/:shareToken (public)
│   └── ReschedulePage.tsx         # /schedule/:shareToken/reschedule/:bookingToken (public)
└── styles/
    └── global.css         # CSS variables, responsive breakpoints
```

## Key Patterns

### Pages (Route Components)

Each page should handle its own data fetching and state:

```typescript
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiClient } from '../api/client';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchProject = async () => {
      try {
        const data = await ApiClient.get(`/projects/${id}`);
        setProject(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchProject();
  }, [id]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="project-detail">
      {/* Page JSX */}
    </div>
  );
}
```

### Components (Reusable UI)

Keep components focused and prop-driven:

```typescript
interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="layout">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <nav>
          <a href="/dashboard">Projects</a>
          {user && <span>Logged in as {user.email}</span>}
          <button onClick={logout}>Logout</button>
        </nav>
      </aside>

      <main>
        <button 
          className="hamburger"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          ☰
        </button>
        {children}
      </main>
    </div>
  );
}
```

### API Client Wrapper

The `api/client.ts` handles:
- Auto-injecting JWT from localStorage
- Parsing JSON responses
- Error extraction and propagation
- Detecting .ics (text/calendar) responses for downloads

```typescript
import { ApiClient } from '../api/client';

// GET with JWT auto-injection
const projects = await ApiClient.get('/projects');

// POST with body
const newProject = await ApiClient.post('/projects', {
  name: 'Q2 Planning',
  session_length_minutes: 60
});

// Download .ics calendar
const icsContent = await ApiClient.get('/schedule/calendar/booking-token-123');
// Client detects text/calendar and returns raw string

// Error handling
try {
  await ApiClient.post('/projects', { name: '' });
} catch (err) {
  console.error(err.message); // Already parsed from { error, details }
}
```

### Context + Hooks

Use `AuthContext` to manage user state globally:

```typescript
import { useAuth } from '../context/AuthContext';

export default function SomeComponent() {
  const { user, login, logout, register } = useAuth();

  const handleLogin = async (email, password) => {
    const result = await login(email, password);
    // user is now set in context
  };

  return (
    <div>
      {user ? (
        <p>Welcome, {user.email}!</p>
        <button onClick={logout}>Logout</button>
      ) : (
        <button onClick={() => handleLogin('email', 'password')}>Login</button>
      )}
    </div>
  );
}
```

### Styling

Use CSS variables for theming — no Tailwind or Bootstrap:

```css
/* styles/global.css */
:root {
  --color-primary: #0066cc;
  --color-error: #cc0000;
  --color-bg: #ffffff;
  --color-border: #e0e0e0;
  
  --breakpoint-tablet: 768px;
  --breakpoint-mobile: 480px;
}

/* Desktop first, then media queries for smaller screens */
.project-card {
  padding: 16px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

@media (max-width: 768px) {
  /* Tablet layout */
  .sidebar {
    position: absolute;
    left: -260px;
    transition: left 0.3s;
  }
  
  .sidebar.open {
    left: 0;
  }
}

@media (max-width: 480px) {
  /* Mobile: single column */
  .form-row {
    flex-direction: column;
  }
}
```

## Multi-Step Flows

### Public Booking Page (`PublicBookingPage.tsx`)

```typescript
export default function PublicBookingPage() {
  const { shareToken } = useParams();
  const [step, setStep] = useState<'password' | 'slots' | 'contact' | 'confirmation'>('password');
  const [project, setProject] = useState(null);
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [contactInfo, setContactInfo] = useState({ first_name: '', last_name: '', email: '', phone: '' });
  const [booking, setBooking] = useState(null);

  // Step 1: Password verification
  const handlePasswordSubmit = async (password) => {
    const data = await ApiClient.get(`/schedule/project/${shareToken}`);
    // Password is checked server-side on booking
    setProject(data.project);
    setSlots(data.available_slots);
    setStep('slots');
  };

  // Step 2: Slot selection
  const handleSlotSelect = (slotId) => {
    setSelectedSlot(slotId);
    setStep('contact');
  };

  // Step 3: Contact form
  const handleContactSubmit = async () => {
    const response = await ApiClient.post(`/schedule/book/${shareToken}`, {
      password, // Saved from step 1
      time_block_id: selectedSlot,
      ...contactInfo
    });
    setBooking(response.booking);
    setStep('confirmation');
  };

  // Step 4: Confirmation with .ics download
  return (
    <div>
      {step === 'password' && <PasswordForm onSubmit={handlePasswordSubmit} />}
      {step === 'slots' && <SlotGrid slots={slots} onSelect={handleSlotSelect} />}
      {step === 'contact' && <ContactForm onSubmit={handleContactSubmit} />}
      {step === 'confirmation' && (
        <ConfirmationPage 
          booking={booking}
          downloadIcs={() => downloadCalendar(booking.booking_token)}
        />
      )}
    </div>
  );
}

function downloadCalendar(bookingToken) {
  ApiClient.get(`/schedule/calendar/${bookingToken}`).then(icsContent => {
    const blob = new Blob([icsContent], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${bookingToken.slice(0, 8)}.ics`;
    a.click();
  });
}
```

## Common Tasks

### Adding a New Page

1. Create component in `pages/NewPage.tsx`
2. Add route in `App.tsx`:
   ```typescript
   <Route path="/new-route" element={<NewPage />} />
   ```
3. Add link in `Layout.tsx` or appropriate component

### Adding a Reusable Component

1. Create in `components/ComponentName.tsx`
2. Define clear prop interface
3. Keep styling scoped with CSS classes or CSS variables
4. Export from component file

### Calling a New API Endpoint

1. Use `ApiClient.get()`, `ApiClient.post()`, etc.
2. Handle errors with try/catch
3. Update loading/error state in component

```typescript
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);

const handleClick = async () => {
  setLoading(true);
  setError(null);
  try {
    const result = await ApiClient.post('/new-endpoint', { data });
    // Handle success
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
};
```

### Handling JWT Expiry

The `AuthContext` manages JWT from localStorage. When a request returns 401:
- `ApiClient` detects the error
- Component should prompt user to re-login
- Call `logout()` from `useAuth()` to clear state

```typescript
const { login, logout } = useAuth();

const handleError = (error) => {
  if (error.status === 401) {
    logout(); // Clear JWT and user state
    navigate('/login');
  }
};
```

## Responsive Design Breakpoints

Use these breakpoints in CSS:
```css
/* Desktop: 1200px+ */
/* Tablet: 768px to 1199px */
@media (max-width: 768px) { /* Hamburger menu, stack forms */ }

/* Mobile: < 480px */
@media (max-width: 480px) { /* Single column, full-width buttons */ }
```

## Performance Tips

- **Lazy load pages** with React.lazy + Suspense for PublicBookingPage (large component)
- **Memoize expensive renders** with useMemo/useCallback
- **Avoid re-renders** by splitting state properly
- **Cache API responses** briefly if refetching is rare (e.g., project list)
- **Minimize CSS** — use CSS variables, avoid redundant selectors

## Testing the Client

```bash
npm run dev
# → Vite dev server on http://localhost:5173
# → API proxied to http://localhost:4000

# Hot reload works — save and see changes instantly
```

## Security Reminders

- ✅ Never store passwords in localStorage (JWT only)
- ✅ Use HTTPS in production (set via reverse proxy)
- ✅ Don't log sensitive data to console
- ✅ Validate forms client-side for UX (server validates for security)
- ✅ Clear JWT on logout
- ❌ Don't run eval() or inject HTML with .innerHTML
- ❌ Don't hardcode API URLs (use VITE_API_URL env var)
- ❌ Don't store booking_token in localStorage (keep in URL for security)
