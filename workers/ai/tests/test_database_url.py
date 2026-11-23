from orbexa_ai.startup import configure_database_url, database_url_from_env


def test_database_url_requires_ssl_and_encodes_the_password() -> None:
    url = database_url_from_env(
        {
            "DB_HOST": "orbexa.example.ap-southeast-2.rds.amazonaws.com",
            "DB_NAME": "orbexa",
            "DB_USER": "orbexa",
            "DB_PASSWORD": "p@ss word",
        }
    )
    assert url.startswith("postgresql://orbexa:p%40ss%20word@")
    assert url.endswith("?sslmode=require")
    assert "p@ss word" not in url


def test_worker_does_not_set_a_url_without_psycopg() -> None:
    env = {
        "DB_HOST": "db.internal",
        "DB_NAME": "orbexa",
        "DB_USER": "orbexa",
        "DB_PASSWORD": "secret",
    }
    assert configure_database_url(env) is False
    assert "ORBEXA_DATABASE_URL" not in env
