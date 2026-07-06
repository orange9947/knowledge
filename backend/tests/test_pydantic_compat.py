from pydantic import BaseModel

from app.pydantic_compat import OrmBaseModel, model_validate


class LegacyOrmModel(OrmBaseModel):
    name: str


class PlainModel(BaseModel):
    name: str


class ObjectPayload:
    name = "RAG"


def test_model_validate_accepts_dict_payloads():
    parsed = model_validate(PlainModel, {"name": "RAG"})

    assert parsed.name == "RAG"


def test_model_validate_accepts_orm_payloads_on_legacy_pydantic_path():
    parsed = model_validate(LegacyOrmModel, ObjectPayload())

    assert parsed.name == "RAG"
