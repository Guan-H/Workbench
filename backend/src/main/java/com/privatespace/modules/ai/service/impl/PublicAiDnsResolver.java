package com.privatespace.modules.ai.service.impl;

import com.privatespace.common.exception.ApiException;
import org.apache.hc.client5.http.DnsResolver;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Arrays;

final class PublicAiDnsResolver implements DnsResolver {
    @Override
    public InetAddress[] resolve(String host) throws UnknownHostException {
        InetAddress[] addresses = InetAddress.getAllByName(host);
        // The HTTP client dials this exact result and still verifies TLS for the original hostname.
        if (Arrays.stream(addresses).anyMatch(address -> !isPublic(address))) {
            throw new ApiException(400, "AI_DESTINATION_NOT_PUBLIC", "自定义服务必须解析到公网地址。");
        }
        return addresses;
    }

    @Override
    public String resolveCanonicalHostname(String host) { return host; }

    static boolean isPublic(InetAddress address) {
        byte[] ip = address.getAddress();
        int first = ip[0] & 0xff;
        int second = ip[1] & 0xff;
        int third = ip[2] & 0xff;
        if (ip.length == 4) {
            return first > 0 && first < 224 && first != 10 && first != 127
                    && !(first == 100 && second >= 64 && second <= 127)
                    && !(first == 169 && second == 254) && !(first == 172 && second >= 16 && second <= 31)
                    && !(first == 192 && (second == 168 || second == 0 && (third == 0 || third == 2) || second == 88 && third == 99))
                    && !(first == 198 && (second == 18 || second == 19 || second == 51 && third == 100))
                    && !(first == 203 && second == 0 && third == 113);
        }
        // Ordinary global unicast, excluding transition, protocol assignment and documentation ranges.
        return (first & 0xe0) == 0x20 && !(first == 0x20 && second == 0x02)
                && !(first == 0x20 && second == 0x01 && (third <= 1 || third == 0x0d && (ip[3] & 0xff) == 0xb8))
                && !(first == 0x3f && second == 0xff && third <= 0x0f);
    }
}
