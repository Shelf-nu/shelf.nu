#!/usr/bin/env python
# -*- coding: utf-8 -*-
from __future__ import print_function
import csv
from datetime import datetime, timedelta
import random

# Define base data for generation
manufacturers = ["Zeiss", "Thermo Scientific", "Agilent", "Bio-Rad", "Eppendorf", "JEOL", "Leica", "Nikon", "Beckman Coulter", "Shimadzu", 
                "Olympus", "Waters", "Perkin Elmer", "Bruker", "Mettler Toledo"]

equipment_types = [
    {
        "category": "Microscopes",
        "prefix": ["LSM", "Axio", "BX", "DMi8", "Eclipse"],
        "tags": ["microscope", "imaging"],
        "base_price": 75000,
        "variance": 25000
    },
    {
        "category": "Centrifuges",
        "prefix": ["Avanti", "Sorvall", "Optima", "Allegra", "5920"],
        "tags": ["centrifuge", "sample prep"],
        "base_price": 40000,
        "variance": 15000
    },
    {
        "category": "Chromatography",
        "prefix": ["HPLC", "UPLC", "Nexera", "Ultimate", "1260"],
        "tags": ["HPLC", "analysis"],
        "base_price": 65000,
        "variance": 20000
    },
    {
        "category": "PCR Equipment",
        "prefix": ["CFX", "QuantStudio", "LightCycler", "ProFlex", "T100"],
        "tags": ["PCR", "gene expression"],
        "base_price": 25000,
        "variance": 10000
    },
    {
        "category": "Cell Culture",
        "prefix": ["CellXpert", "HeraCell", "Galaxy", "MCO", "DirectHeat"],
        "tags": ["incubator", "cell culture"],
        "base_price": 15000,
        "variance": 5000
    }
]

# Exactly 50 locations
locations = [
    # Research Labs (20)
    "Cell Biology Lab A", "Cell Biology Lab B", "Cell Biology Lab C", "Cell Biology Lab D",
    "Biochemistry Lab 1", "Biochemistry Lab 2", "Biochemistry Lab 3", "Biochemistry Lab 4",
    "Molecular Biology Lab A", "Molecular Biology Lab B", "Molecular Biology Lab C",
    "Genetics Lab 1", "Genetics Lab 2", "Genetics Lab 3",
    "Microbiology Lab A", "Microbiology Lab B", "Microbiology Lab C",
    "Immunology Lab 1", "Immunology Lab 2", "Immunology Lab 3",

    # Core Facilities (10)
    "Genomics Facility", "Proteomics Facility", "Metabolomics Facility",
    "Flow Cytometry Core", "Mass Spectrometry Core", "Crystallography Core",
    "Electron Microscopy Suite", "Live Cell Imaging Facility",
    "Bioinformatics Center", "High-Performance Computing Lab",

    # Specialized Labs (10)
    "Drug Discovery Unit", "Antibody Development Lab", "Stem Cell Research Center",
    "Tissue Culture Facility", "Animal Research Facility", "Plant Science Lab",
    "Bioengineering Lab", "Synthetic Biology Lab", "Nanobiotechnology Lab",
    "Systems Biology Lab",

    # Clinical and Research Support (10)
    "Clinical Research Lab 1", "Clinical Research Lab 2",
    "Translational Research Lab 1", "Translational Research Lab 2",
    "Pathology Lab", "Histology Lab",
    "Quality Control Lab", "Method Development Lab",
    "Environmental Testing Lab", "Analytical Chemistry Lab"
]

# Exactly 50 custodians
custodians = [
    # Full Professors (12)
    "Prof. Michael Chen", "Prof. Sarah Williams", "Prof. David Rodriguez",
    "Prof. Emily Taylor", "Prof. James Wilson", "Prof. Maria Garcia",
    "Prof. Robert Johnson", "Prof. Lisa Anderson", "Prof. Thomas Brown",
    "Prof. Jennifer Lee", "Prof. William Davis", "Prof. Elizabeth Martinez",

    # Associate Professors (12)
    "Assoc. Prof. Richard Kim", "Assoc. Prof. Laura Smith", "Assoc. Prof. John Zhang",
    "Assoc. Prof. Amanda White", "Assoc. Prof. Daniel Park", "Assoc. Prof. Sofia Patel",
    "Assoc. Prof. Kevin Wong", "Assoc. Prof. Rachel Green", "Assoc. Prof. Carlos Lopez",
    "Assoc. Prof. Michelle Thompson", "Assoc. Prof. Christopher Lee", "Assoc. Prof. Jessica Chen",

    # Research Group Leaders (13)
    "Dr. Andrew Wilson", "Dr. Nicole Anderson", "Dr. Matthew Brown",
    "Dr. Victoria Davis", "Dr. Benjamin Liu", "Dr. Sophia Rodriguez",
    "Dr. Katherine White", "Dr. Alexander Wong", "Dr. Isabella Santos",
    "Dr. Jonathan Lee", "Dr. Margaret Chen", "Dr. Richard Brown",
    "Dr. Emma Thompson",

    # Core Facility Managers (13)
    "Lab Mgr. David Palmer", "Lab Mgr. Susan Martinez", "Lab Mgr. Michael Roberts",
    "Lab Mgr. Laura Wilson", "Lab Mgr. Robert Taylor", "Lab Mgr. Sarah Johnson",
    "Lab Mgr. Mark Thompson", "Lab Mgr. Anna Garcia", "Lab Mgr. Paul Zhang",
    "Lab Mgr. Linda Kim", "Lab Mgr. Steven Lee", "Lab Mgr. Rebecca Wilson",
    "Lab Mgr. Peter Wang"
]

# Generate 2000 records
records = []
current_date = datetime.now()

for i in range(2000):
    # Select random equipment type
    equip_type = random.choice(equipment_types)
    manufacturer = random.choice(manufacturers)
    
    # Generate dates
    purchase_date = current_date - timedelta(days=random.randint(0, 1460))  # Up to 4 years ago
    warranty_years = random.choice([3, 5, 7])
    warranty_expiry = purchase_date + timedelta(days=365 * warranty_years)
    last_calibration = current_date - timedelta(days=random.randint(0, 365))  # Within the last year
    
    # Generate asset ID
    asset_id = "{0}{1}-{2}".format(
        manufacturer[:2].upper(),
        str(random.randint(1000, 9999)),
        str(random.randint(100, 999))
    )
    
    # Generate title
    model_number = "{0} {1}".format(
        random.choice(equip_type['prefix']),
        str(random.randint(1000, 9999))
    )
    title = "{0} {1}".format(manufacturer, model_number)
    
    # Generate valuation with some variance
    valuation = equip_type['base_price'] + random.randint(-equip_type['variance'], equip_type['variance'])
    
    # Simple random choice for status based on approximate probabilities
    r = random.random()
    if r < 0.8:
        status = "Operational"
    elif r < 0.9:
        status = "Under Maintenance"
    elif r < 0.95:
        status = "New"
    else:
        status = "Needs Repair"
    
    record = {
        "title": title,
        "description": "{0} for {1}".format(model_number, equip_type['tags'][0]),
        "category": equip_type['category'],
        "tags": ",".join(equip_type['tags']),
        "location": random.choice(locations),
        "valuation": valuation,
        "custodian": random.choice(custodians),
        "cf:Asset ID,type:text": asset_id,
        "cf:Manufacturer,type:option": manufacturer,
        "cf:Purchase date,type:date": purchase_date.strftime("%m/%d/%Y"),
        "cf:Warranty expiry,type:date": warranty_expiry.strftime("%m/%d/%Y"),
        "cf:Last calibration,type:date": last_calibration.strftime("%m/%d/%Y"),
        "cf:Operational status,type:option": status,
        "cf:Requires certification,type:boolean": "yes" if random.random() < 0.9 else "no"
    }
    records.append(record)

# Define column order to match the header exactly
column_order = [
    "title",
    "description",
    "category",
    "tags",
    "location",
    "valuation",
    "custodian",
    "cf:Asset ID,type:text",
    "cf:Manufacturer,type:option",
    "cf:Purchase date,type:date",
    "cf:Warranty expiry,type:date",
    "cf:Last calibration,type:date",
    "cf:Operational status,type:option",
    "cf:Requires certification,type:boolean"
]

# Write to CSV file
filename = 'lab_equipment_2000.csv'
with open(filename, 'w') as f:
    # Write header
    header = ";".join(column_order) + "\n"
    f.write(header)
    
    # Write records in correct order
    for record in records:
        # Ensure values are in the correct order
        ordered_values = [str(record[col]) for col in column_order]
        line = ";".join(ordered_values) + "\n"
        f.write(line)

print("CSV file has been generated: {0}".format(filename))
print("Generated {0} records".format(len(records)))
print("Number of unique locations: {0}".format(len(set(loc for rec in records for loc in [rec['location']]))))
print("Number of unique custodians: {0}".format(len(set(cust for rec in records for cust in [rec['custodian']]))))