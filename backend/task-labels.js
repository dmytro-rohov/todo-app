// Label changes and task changes commit together. Old categoryId writers keep
// their primary-label semantics and never delete unrelated additional labels.
async function withTaskLabels(pool, labelIds, write) {
  if (labelIds === undefined) return write(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await write(client);
    if (result.rowCount) {
      const id = result.rows[0].id;
      await client.query('DELETE FROM task_labels WHERE task_id=$1', [id]);
      if (labelIds.length > 1) await client.query('INSERT INTO task_labels (task_id, category_id) SELECT $1, unnest($2::integer[])', [id, labelIds.slice(1)]);
      result.rows[0].labelIds = [...labelIds].sort((a,b)=>a-b);
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
module.exports = { withTaskLabels };
