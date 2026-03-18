package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
)

// findAvailablePort 查找一个可用的端口
func findAvailablePort(startPort int) (int, error) {
	for port := startPort; port < 65535; port++ {
		listener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
		if err == nil {
			listener.Close()
			return port, nil
		}
	}
	return 0, fmt.Errorf("no available port found")
}

// openBrowser 在默认浏览器中打开URL
func openBrowser(url string) error {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin": // macOS
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	default:
		return fmt.Errorf("unsupported platform")
	}

	return cmd.Start()
}

// getLocalIP 获取本机局域网IP地址
func getLocalIP() (string, error) {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return "", err
	}

	for _, addr := range addrs {
		// 检查IP地址是否为IPv4且不是回环地址
		if ipNet, ok := addr.(*net.IPNet); ok && !ipNet.IP.IsLoopback() {
			if ipNet.IP.To4() != nil {
				ip := ipNet.IP.String()
				// 优先返回私有地址（192.168.x.x, 10.x.x.x, 172.16-31.x.x）
				if isPrivateIP(ip) {
					return ip, nil
				}
			}
		}
	}
	return "", fmt.Errorf("could not find local IP address")
}

// isPrivateIP 检查是否为私有IP地址
func isPrivateIP(ip string) bool {
	return len(ip) > 0 && (
		// 10.0.0.0/8
		ip[:3] == "10." ||
		// 172.16.0.0/12
		(len(ip) > 4 && ip[:4] == "172." && ip[4] >= '1' && ip[4] <= '3' && ip[5] == '.') ||
		// 192.168.0.0/16
		ip[:8] == "192.168.")
}

func main() {
	// 获取当前目录
	dir, err := os.Getwd()
	if err != nil {
		log.Fatalf("Failed to get current directory: %v", err)
	}

	// 查找可用端口
	port, err := findAvailablePort(8080)
	if err != nil {
		log.Fatalf("Failed to find available port: %v", err)
	}

	// 创建文件服务器
	fs := http.FileServer(http.Dir(dir))
	http.Handle("/", fs)

	// 获取本机IP地址
	ip, err := getLocalIP()
	if err != nil {
		log.Printf("Warning: Could not get local IP: %v", err)
		ip = "localhost"
	}

	// 构建URL
	localURL := fmt.Sprintf("http://localhost:%d", port)
	networkURL := fmt.Sprintf("http://%s:%d", ip, port)

	fmt.Printf("Starting server...\n")
	fmt.Printf("Local access:   %s\n", localURL)
	fmt.Printf("Network access: %s\n", networkURL)
	fmt.Printf("Serving files from: %s\n", dir)
	fmt.Println("Press Ctrl+C to stop the server")

	// 在goroutine中启动服务器
	go func() {
		addr := ":" + strconv.Itoa(port) // 监听所有网络接口
		if err := http.ListenAndServe(addr, nil); err != nil {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	// 等待一小段时间确保服务器已启动
	// 然后打开浏览器（优先使用网络地址）
	fmt.Println("Opening browser...")
	openURL := networkURL
	if ip == "localhost" {
		openURL = localURL // 如果获取不到IP，则使用本地地址
	}
	if err := openBrowser(openURL); err != nil {
		fmt.Printf("Failed to open browser automatically: %v\n", err)
		fmt.Printf("Please manually open: %s or %s\n", localURL, networkURL)
	}

	// 阻塞主线程，保持服务器运行
	select {}
}
