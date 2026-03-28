---
description: "Create a new React page component with routing, data fetching, and responsive layout"
argument-hint: "Describe the page: route path, purpose, and what data it displays (e.g., /admin/reports for showing booking analytics)"
agent: "agent"
---

# Add Frontend Page

I'll help you create a new React page component following the monorepo conventions.

**Please provide:**
1. **Route path** (e.g., `/settings`, `/projects/:id/analytics`, `/schedule/:token/confirm`)
2. **Page purpose** (what does this page do?)
3. **Auth required?** (protected by JWT, public, or guest-only?)
4. **Data sources** (which API endpoints does it fetch from?)
5. **Key features** (primary UI elements or interactions)

---

## Implementation Checklist

Once you provide those details, I'll help you:

### 1. **Create Page Component** (route handler)
   - Create `packages/client/src/pages/NewPage.tsx`
   - Use functional component with hooks
   - Handle useParams for dynamic segments (`:id`, `:token`)
   - Implement useEffect for data fetching
   - Track loading, error, and data state

### 2. **Add Route in App.tsx**
   - Import page component
   - Add `<Route path="/path" element={<Page />} />`
   - Wrap protected routes with auth check
   - Add public/guest-only wrappers as needed

### 3. **Create Sub-Components** (if needed)
   - Extract reusable UI into `packages/client/src/components/`
   - Keep components focused and prop-driven
   - Use CSS variables for styling

### 4. **Add Navigation Links**
   - Update `components/Layout.tsx` sidebar/nav
   - Link to new page from relevant pages
   - Show/hide based on user role if applicable

### 5. **Style with Responsive Design**
   - Use CSS variables from `styles/global.css`
   - Desktop: fixed sidebar + fluid content
   - Tablet ≤768px: collapsible sidebar
   - Mobile ≤480px: single column, full-width buttons

### 6. **Integrate API Client**
   - Import `ApiClient` from `api/client.ts`
   - Fetch data in useEffect
   - Handle JWT auth automatically
   - Update component state with response
   - Display errors to user

### 7. **Test Locally**
   - Navigate to the route in browser
   - Verify data fetching and rendering
   - Test responsive breakpoints
   - Check auth restrictions (if applicable)

---

## Example Page Structure

```typescript
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiClient } from '../api/client';
import Layout from '../components/Layout';

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

  return (
    <Layout>
      <div className="page-content">
        {loading && <p>Loading...</p>}
        {error && <p className="error">{error}</p>}
        {project && (
          <>
            <h1>{project.name}</h1>
            {/* Page content */}
          </>
        )}
      </div>
    </Layout>
  );
}
```

---

## Reference

See [.github/instructions/frontend.instructions.md](../instructions/frontend.instructions.md) for:
- Page component patterns
- Context + hooks usage
- API client examples
- Multi-step flow patterns (booking flow)
- Responsive design breakpoints

See [docs/ARCHITECTURE.md § 7. Frontend Architecture](../../docs/ARCHITECTURE.md#7-frontend-architecture) for:
- Routing map (all pages + auth rules)
- Component tree overview
- Component responsibilities

---

**Ready? Provide the page details above and I'll generate the implementation!**
