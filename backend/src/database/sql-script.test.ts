import assert from 'node:assert/strict'
import test from 'node:test'
import { splitSqlScript } from './sql-script.js'

test('separa enunciados y conserva el cuerpo de un disparador', () => {
  const statements = splitSqlScript(`
    -- comentario con punto y coma;
    CREATE TABLE example (id INT);
    CREATE TRIGGER tr_example
    BEFORE INSERT ON example
    FOR EACH ROW
    BEGIN
      IF NEW.id IS NULL THEN
        SET NEW.id = 1;
      END IF;
    END;
    INSERT INTO example (id) VALUES (1);
  `)

  assert.equal(statements.length, 3)
  assert.match(statements[0] ?? '', /CREATE TABLE/)
  assert.match(statements[1] ?? '', /CREATE TRIGGER/)
  assert.match(statements[1] ?? '', /END IF;/)
  assert.match(statements[1] ?? '', /END\s*$/)
  assert.match(statements[2] ?? '', /INSERT INTO example/)
})

test('no corta una cadena que contiene un punto y coma', () => {
  const statements = splitSqlScript("INSERT INTO notes (body) VALUES ('a;b'); SELECT 1;")
  assert.equal(statements.length, 2)
  assert.match(statements[0] ?? '', /'a;b'/)
})
