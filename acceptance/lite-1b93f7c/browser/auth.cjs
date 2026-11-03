function credentials(env=process.env) {
  if(env.TASKS_DISPOSABLE_APPROVED!=='yes' || !/^[a-f0-9]{64}$/.test(env.AUTH_PASSWORD||'')) throw new Error('Approved random auth handoff required');
  return {username:'owner',password:env.AUTH_PASSWORD};
}
module.exports={credentials};
