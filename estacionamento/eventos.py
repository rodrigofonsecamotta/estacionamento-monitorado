"""Histórico de entradas/saídas em SQLite."""
from __future__ import annotations

import sqlite3
from pathlib import Path


class RepositorioEventos:
    def __init__(self, caminho: Path):
        self.caminho = caminho
        caminho.parent.mkdir(parents=True, exist_ok=True)
        with self._conectar() as con:
            con.execute(
                """CREATE TABLE IF NOT EXISTS eventos (
                       id INTEGER PRIMARY KEY AUTOINCREMENT,
                       vaga TEXT NOT NULL,
                       ocupada INTEGER NOT NULL,
                       momento TEXT NOT NULL
                   )"""
            )

    def _conectar(self) -> sqlite3.Connection:
        # Uma conexão por operação: simples e segura entre threads.
        return sqlite3.connect(self.caminho)

    def registrar(self, evento: dict) -> None:
        with self._conectar() as con:
            con.execute(
                "INSERT INTO eventos (vaga, ocupada, momento) VALUES (?, ?, ?)",
                (evento["vaga"], int(evento["ocupada"]), evento["momento"]),
            )

    def ultimos(self, limite: int = 50) -> list[dict]:
        with self._conectar() as con:
            linhas = con.execute(
                "SELECT vaga, ocupada, momento FROM eventos ORDER BY id DESC LIMIT ?",
                (limite,),
            ).fetchall()
        return [{"vaga": v, "ocupada": bool(o), "momento": m} for v, o, m in linhas]
