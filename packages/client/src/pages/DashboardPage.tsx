import { useEffect, useState } from 'react';

import { apiFetch } from '../api/client.js';

interface ProjectSummary {
  id: number;
  name: string;
  description: string;
  session_length_minutes: number;
  time_block_count: string;
  active_booking_count: string;
}

interface ProjectsResponse {
  projects: ProjectSummary[];
}

export function DashboardPage(): JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await apiFetch<ProjectsResponse>('/projects');
        setProjects(response.projects);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load projects');
      }
    })();
  }, []);

  return (
    <section>
      <h2>Dashboard</h2>
      {error ? <p className="error">{error}</p> : null}
      <ul className="project-grid">
        {projects.map((project) => (
          <li key={project.id}>
            <h3>{project.name}</h3>
            <p>{project.description || 'No description yet.'}</p>
            <small>
              {project.session_length_minutes} min sessions • {project.time_block_count} blocks •{' '}
              {project.active_booking_count} active bookings
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
