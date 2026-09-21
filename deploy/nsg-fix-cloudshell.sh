#!/usr/bin/env bash
# JARVIS NSG FIX — paste into Azure Portal → Cloud Shell (Bash).
# Finds the jarvis VM's NIC security group automatically and reopens port 8080,
# which the resource-group move dropped. Idempotent: skips if the rule exists.
set -e

RG="LEWIS_GROUP"
VM="jarvis"

echo "── subscription check"
az account show --query "{name:name, id:id}" -o table || { echo "Run 'az login' or set the Azure for Students subscription first"; exit 1; }
az account set --subscription 95f3064f-112d-4ca7-b861-10ea1834c7bd 2>/dev/null || true

echo "── finding the VM's NIC and NSG..."
NIC_ID=$(az vm show -g "$RG" -n "$VM" --query "networkProfile.networkInterfaces[0].id" -o tsv)
NIC=$(basename "$NIC_ID")
NSG_ID=$(az network nic show --ids "$NIC_ID" --query "networkSecurityGroup.id" -o tsv || true)

if [ -z "$NSG_ID" ]; then
  echo "NIC has no NSG attached — creating one and attaching it..."
  az network nsg create -g "$RG" -n jarvis-nsg -o none
  az network nic ip-config update -g "$RG" --nic-name "$NIC" -n ipconfigjarvis \
    --nsg jarvis-nsg -o none 2>/dev/null || \
  az network nic ip-config update -g "$RG" --nic-name "$NIC" \
    $(az network nic show --ids "$NIC_ID" --query "ipConfigurations[0].name" -o tsv | xargs -I{} echo "--ip-config-name {}") \
    --nsg jarvis-nsg -o none
  NSG_ID=$(az network nic show --ids "$NIC_ID" --query "networkSecurityGroup.id" -o tsv)
fi

NSG=$(basename "$NSG_ID")
echo "   NIC: $NIC"
echo "   NSG: $NSG"

echo "── current inbound rules:"
az network nsg rule list -g "$RG" --nsg-name "$NSG" \
  --query "[].{name:name, port:destinationPortRange, access:access, dir:direction}" -o table

echo "── ensuring allow-8080 rule exists..."
if az network nsg rule show -g "$RG" --nsg-name "$NSG" -n allow-8080 >/dev/null 2>&1; then
  echo "   rule already exists — updating it to be safe"
  az network nsg rule update -g "$RG" --nsg-name "$NSG" -n allow-8080 \
    --priority 310 --direction Inbound --access Allow --protocol Tcp \
    --destination-port-ranges 8080 -o none
else
  az network nsg rule create -g "$RG" --nsg-name "$NSG" -n allow-8080 \
    --priority 310 --direction Inbound --access Allow --protocol Tcp \
    --source-address-prefixes "*" --destination-port-ranges 8080 \
    --description "JARVIS backend API (Vercel proxy target)" -o none
fi

# Bonus: keep SSH open explicitly too (it currently works, but make it durable)
az network nsg rule show -g "$RG" --nsg-name "$NSG" -n allow-ssh >/dev/null 2>&1 || \
  az network nsg rule create -g "$RG" --nsg-name "$NSG" -n allow-ssh \
    --priority 300 --direction Inbound --access Allow --protocol Tcp \
    --source-address-prefixes "*" --destination-port-ranges 22 \
    --description "SSH" -o none

echo "── final inbound rules:"
az network nsg rule list -g "$RG" --nsg-name "$NSG" \
  --query "[?direction=='Inbound'].{name:name, port:destinationPortRange, access:access}" -o table

echo "── done. Verifying from your machine in ~30s:"
echo "   curl -m 15 https://jarvis.imeantech.com/api/system"
