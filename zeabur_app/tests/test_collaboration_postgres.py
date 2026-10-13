import os
import sys
import types
import unittest


class _Cursor:
    def __init__(self, statements):
        self.statements = statements

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params=None):
        self.statements.append((sql, params))


class _Connection:
    def __init__(self, statements):
        self.statements = statements

    def cursor(self):
        return _Cursor(self.statements)

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass


class CollaborationPostgresTests(unittest.TestCase):
    def setUp(self):
        self.statements = []
        self.calls = []
        fake_psycopg = types.ModuleType("psycopg")

        def connect(**kwargs):
            self.calls.append(kwargs)
            return _Connection(self.statements)

        fake_psycopg.connect = connect
        fake_rows = types.ModuleType("psycopg.rows")
        fake_rows.dict_row = object()
        sys.modules["psycopg"] = fake_psycopg
        sys.modules["psycopg.rows"] = fake_rows
        os.environ.update({
            "COLLAB_DB_HOST": "db.example",
            "COLLAB_DB_PORT": "5432",
            "COLLAB_DB_NAME": "ocr_workbench",
            "COLLAB_DB_USER": "tibetan_collab",
            "COLLAB_DB_PASSWORD": "secret",
            "COLLAB_DB_SCHEMA": "tibetan_collab",
            "COLLABORATOR_NAMES": "甲,乙",
            "COLLABORATION_PASSWORD": "shared",
            "COLLAB_SESSION_SECRET": "session",
        })
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
        import zeabur_app.collaboration as collaboration
        self.collaboration = collaboration
        collaboration._schema_ready = False

    def tearDown(self):
        for key in ("COLLAB_DB_HOST", "COLLAB_DB_PORT", "COLLAB_DB_NAME", "COLLAB_DB_USER", "COLLAB_DB_PASSWORD", "COLLAB_DB_SCHEMA", "COLLABORATOR_NAMES", "COLLABORATION_PASSWORD", "COLLAB_SESSION_SECRET"):
            os.environ.pop(key, None)

    def test_password_is_optional_for_test_login(self):
        os.environ["COLLABORATION_PASSWORD"] = ""
        self.assertTrue(self.collaboration.configured())
        self.assertFalse(self.collaboration.password_required())

    def test_connect_uses_postgres_and_schema(self):
        self.collaboration._connect()
        self.assertEqual(self.calls[0]["dbname"], "ocr_workbench")
        self.assertEqual(self.calls[0]["port"], 5432)
        self.assertEqual(self.calls[0]["options"], "-c search_path=tibetan_collab,public")

    def test_initialize_creates_schema_qualified_postgres_tables(self):
        self.collaboration._initialize_schema()
        sql = "\n".join(statement for statement, _params in self.statements)
        self.assertIn("CREATE SCHEMA IF NOT EXISTS tibetan_collab", sql)
        self.assertIn("tibetan_collab.collab_book_state", sql)
        self.assertIn("BIGSERIAL PRIMARY KEY", sql)
        self.assertNotIn("AUTO_INCREMENT", sql)
        self.assertNotIn("CHARACTER SET", sql)


if __name__ == "__main__":
    unittest.main()
