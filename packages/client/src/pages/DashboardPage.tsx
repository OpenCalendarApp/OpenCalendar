import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { ProjectSummary, ProjectsResponse } from '@session-scheduler/shared';

import { apiFetch } from '../api/client.js';
import { CreateProjectModal } from '../components/CreateProjectModal.js';
import { useAuth } from '../context/AuthContext.js';

export function DashboardPage(): JSX.Element {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiFetch<ProjectsResponse>('/projects');
      setProjects(response.projects);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load projects');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  return (
    <section>
      <div className="header-row">
        <h2>Dashboard</h2>
        {user?.role === 'pm' ? (
          <button type="button" onClick={() => setIsCreateModalOpen(true)} className="header-button">
            Create Project
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="detail-card status-card">
          <p className="error">{error}</p>
        </div>
      ) : null}

      {isLoading ? (
        <div className="detail-card status-card">
          <p>Loading projects...</p>
        </div>
      ) : null}

      {!isLoading && !error && projects.length === 0 ? (
        <p className="hint">No projects yet. Create your first project to begin scheduling.</p>
      ) : null}

      <ul className="project-grid">
        {projects.map((project) => (
          <li key={project.id}>
            <h3>
              <Link to={`/projects/${project.id}`} className="inline-link">
                {project.name}
              </Link>
            </h3>
            <p>{project.description || 'No description yet.'}</p>
            <small>
              {project.session_length_minutes} min sessions • {project.time_block_count} blocks •{' '}
              {project.active_booking_count} active bookings
            </small>
          </li>
        ))}
      </ul>

      {isCreateModalOpen ? (
        <CreateProjectModal
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={loadProjects}
        />
      ) : null}
    </section>
  );
}
