export default function Login() {
  return (
    <div className="login">
      <form className="card login-card" onSubmit={(e) => e.preventDefault()}>
        <div className="brand"><span className="mark" />SignalGrid</div>
        <h1>Sign in</h1>
        <input type="email" placeholder="you@company.com" />
        <input type="password" placeholder="Password" />
        <button className="btn" type="submit">Sign in</button>
      </form>
    </div>
  );
}
