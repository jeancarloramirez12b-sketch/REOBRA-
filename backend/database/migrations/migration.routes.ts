import { Router } from 'express';
import { exec } from 'child_process';
import path from 'path';

const router = Router();

// Ruta temporal para ejecutar migraciones
router.get('/api/run-migrations', (req, res) => {
  // Busca la carpeta raíz del backend para ejecutar el comando
  const backendDir = path.resolve(process.cwd(), 'backend'); 
  
  exec('npm run db:migrate', { cwd: backendDir }, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      return res.status(500).json({ error: 'Migration failed', details: stderr });
    }
    console.log(`Output: ${stdout}`);
    res.json({ message: 'Migrations executed successfully', output: stdout });
  });
});

export default router;
