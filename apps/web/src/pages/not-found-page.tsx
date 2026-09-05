import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="page-center">
      <div className="card">
        <h1>404</h1>
        <p className="muted">Pagina nao encontrada.</p>
        <Link to="/">Voltar ao inicio</Link>
      </div>
    </div>
  );
}
