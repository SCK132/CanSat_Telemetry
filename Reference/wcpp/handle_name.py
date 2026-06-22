import json
import os

script_dir = os.path.dirname(os.path.abspath(__file__))
json_file_path = os.path.join(script_dir, "id_name_mapping.json")

with open(json_file_path, "r") as f:
    id_name_mapping = json.load(f)


def handle_name(name: str, name_type: str):
    # Is name_type valid?
    name_type = name_type.lower()
    if name_type in id_name_mapping:
        name_dict = id_name_mapping.get(name_type)
    else:
        return name

    
    if(type(name) == int):
        name = str(name)

    # if name is an id
    if name in name_dict:
        return name_dict.get(name)
    
    # if name in [int(key) for key in name_dict]:
    #     return name_dict.get(name)


    # if name is a name
    name = name.lower()
    for key, value in name_dict.items():
        value = value.lower()
        if name == value:
            return key

    # if name is not found
    return name
