#!/bin/sh
set -eu

template="/opt/opencalendar/default.conf.template"
output="/etc/nginx/conf.d/default.conf"
api_upstream="${API_UPSTREAM:-http://server:4000}"

sed "s#__API_UPSTREAM__#${api_upstream}#g" "${template}" > "${output}"
