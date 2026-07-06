from __future__ import annotations

from typing import Any, TypeVar

from pydantic import BaseModel

if hasattr(BaseModel, "model_validate"):
    from pydantic import ConfigDict

    class OrmBaseModel(BaseModel):
        model_config = ConfigDict(from_attributes=True)


else:

    class OrmBaseModel(BaseModel):
        class Config:
            orm_mode = True


ModelT = TypeVar("ModelT", bound=BaseModel)


def model_dump(instance: BaseModel) -> dict[str, Any]:
    if hasattr(instance, "model_dump"):
        return instance.model_dump()
    return instance.dict()


def model_dump_json(instance: BaseModel) -> str:
    if hasattr(instance, "model_dump_json"):
        return instance.model_dump_json()
    return instance.json()


def model_validate(model: type[ModelT], payload: Any) -> ModelT:
    if hasattr(model, "model_validate"):
        return model.model_validate(payload)
    if hasattr(model, "from_orm") and not isinstance(payload, dict):
        return model.from_orm(payload)
    return model.parse_obj(payload)


def model_fields_set(instance: BaseModel) -> set[str]:
    fields = getattr(instance, "model_fields_set", None)
    if fields is not None:
        return set(fields)
    return set(getattr(instance, "__fields_set__", set()))
